/**
 * 欢迎来到 Cloudflare Pages GitHub 代理脚本!
 *
 * @功能
 * 1. 代理多个 GitHub 相关域名，允许通过自定义域名访问。
 * 2. 支持对 `github.com` 下的仓库进行白名单控制。
 * 3. 自动处理 HTTP 请求的各种方法 (GET, POST, etc.) 和 headers。
 * 4. 自动重写301/302重定向，使其指向代理域名。
 *
 * @配置
 * - `WHITELIST`: 数组，包含了允许访问的 GitHub 仓库列表，格式为 'owner/repo'。
 * - `ALLOWED_HOSTS`: 数组，包含了允许代理的目标域名。
 */

// --- 配置区域 ---

/**
 * @description 仓库白名单
 * 只有在这里列出的仓库 (例如 'owner/repo') 才能通过 `github.com` 的代理访问。
 * 这提供了一层基本的安全控制。
 * 示例:
 * const WHITELIST = [
 *   'your-username/your-repo',
 *   'another-org/another-repo'
 * ];
 */
const WHITELIST = [
    // 在这里添加你想要放行的仓库，例如:
     ''
  ];
  
  /**
   * @description 允许代理的目标主机名
   * 出于安全考虑，只有在此列表中的域名才会被代理。
   */
  const ALLOWED_HOSTS = [
    "github.com",
    "raw.githubusercontent.com",
    "gist.githubusercontent.com",
    "api.github.com",
    "gist.github.com",
    "objects.githubusercontent.com", // LFS aeneid
    "github.githubassets.com", // 资源文件
    "camo.githubusercontent.com", // 图片代理
  ];
  
  // --- Helper Functions ---
  
  /**
   * 从不同 GitHub 域名的 URL 中提取仓库路径 ('owner/repo')。
   * @param {URL} url - 目标 URL 对象。
   * @returns {string|null} - 返回 'owner/repo' 格式的字符串，如果无法提取则返回 null。
   */
  function getRepoFromUrl(url) {
    const hostname = url.hostname;
    // 分割路径并过滤掉空字符串，例如 /user/repo -> ['user', 'repo']
    const pathParts = url.pathname.split('/').filter(p => p);
  
    if (hostname === 'github.com' && pathParts.length >= 2) {
      return `${pathParts[0]}/${pathParts[1]}`;
    }
    if (hostname === 'raw.githubusercontent.com' && pathParts.length >= 2) {
      return `${pathParts[0]}/${pathParts[1]}`;
    }
    // 对于 API 请求，路径通常是 /repos/owner/repo
    if (hostname === 'api.github.com' && pathParts[0] === 'repos' && pathParts.length >= 3) {
      return `${pathParts[1]}/${pathParts[2]}`;
    }
  
    // 对于其他域名或无法识别的路径结构，不应用仓库白名单
    return null;
  }
  
  // --- 核心逻辑 ---
  
  export async function onRequest(context) {
    const { request } = context;
    const requestUrl = new URL(request.url);
  
    // 从 `url` 查询参数中获取目标 URL
    const targetUrlStr = requestUrl.searchParams.get('url');
  
    // 如果没有提供 url 参数，则显示用法
    if (!targetUrlStr) {
      return new Response('欢迎使用 GitHub Proxy. 请使用格式 /?url=<URL> 进行访问。', {
        status: 200,
        headers: {'Content-Type': 'text/plain; charset=utf-8'}
      });
    }
    
    try {
      const targetUrl = new URL(targetUrlStr);
  
      // 1. 安全检查：检查目标主机是否在允许列表中
      if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
        return new Response(`主机名 ${targetUrl.hostname} 不被允许代理。`, { status: 403 });
      }
  
      // 2. 统一的白名单检查：如果白名单不为空，则对相关域名进行检查
      if (WHITELIST.length > 0) {
        const repo = getRepoFromUrl(targetUrl);
        const allowAll = WHITELIST.includes('*/*');
        if (!allowAll && repo && !WHITELIST.includes(repo)) {
          return new Response(`仓库 ${repo} 不在白名单中，拒绝访问。`, { status: 403 });
        }
      }
      
  
      // 3. 构造代理请求
      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.set('Host', targetUrl.hostname);
      proxyHeaders.set('Referer', targetUrl.toString());
  
      // 4. 发起 fetch 请求到目标服务器
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: proxyHeaders,
        body: request.body,
        redirect: 'manual'
      });
  
      // 5. 处理响应
      const responseHeaders = new Headers(response.headers);
      
      // 检查是否是重定向响应
      if ([301, 302, 307, 308].includes(response.status)) {
          let location = responseHeaders.get('Location');
          if (location) {
              // 将重定向的 URL 重写为通过我们的代理访问的地址，并进行URL编码
              const newLocation = `${requestUrl.origin}/?url=${encodeURIComponent(location)}`;
              responseHeaders.set('Location', newLocation);
          }
      }
  
      // 出于安全和兼容性考虑，移除一些可能引起问题的 headers
      responseHeaders.delete('Content-Security-Policy');
      responseHeaders.delete('Content-Security-Policy-Report-Only');
      responseHeaders.delete('Strict-Transport-Security');
      responseHeaders.delete('X-Frame-Options');
  
      // 返回最终的响应给客户端
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
  
    } catch (e) {
      return new Response(`URL 格式无效或处理时发生错误: "${targetUrlStr}" -> ${e.message}`, { status: 400 });
    }
  }
