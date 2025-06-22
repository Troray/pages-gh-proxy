/**
 * GitHub代理服务器 (v2 - Query Parameter Mode)
 * 基于Cloudflare Pages Functions环境
 * 
 * 功能：
 * 1. 通过URL查询参数 ?url=... 代理GitHub请求
 * 2. 支持通过环境变量设置白名单
 * 3. 根路径提供清晰的用法说明
 */

// GitHub相关域名
const GITHUB_DOMAINS = [
  "github.com",
  "raw.githubusercontent.com",
  "api.github.com",
  "gist.github.com",
  "objects.githubusercontent.com", // LFS对象
  "github.githubassets.com", // 资源文件
  "camo.githubusercontent.com", // 图片代理
];

// 处理请求
export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const url = new URL(request.url);
  
  const targetUrlStr = url.searchParams.get('url');

  // 如果没有 'url' 参数, 显示用法
  if (!targetUrlStr) {
    const usage = `GitHub Proxy is running.
Usage: ${url.origin}/?url=https://github.com/user/repo

Example:
${url.origin}/?url=https://api.github.com/repos/OpenListTeam/OpenList/releases`;
    return new Response(usage, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  // 验证目标URL
  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (e) {
    return new Response(`无效的目标URL: ${targetUrlStr}`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  
  // 检查是否是GitHub域名
  if (!GITHUB_DOMAINS.includes(targetUrl.hostname)) {
    return new Response("仅支持GitHub相关域名", {
      status: 403,
      headers: { "Content-Type": "text/plain" }
    });
  }
  
  // 从环境变量中获取白名单
  const whitelist = getWhitelistFromEnv(env);
  
  // 检查白名单 (如果有白名单设置)
  if (whitelist.length > 0) {
    let repoPath = getRepoPathFromUrl(targetUrl);
    
    if (repoPath) {
      const [owner] = repoPath.split('/');
      const isAllowed = whitelist.includes(repoPath) || whitelist.includes('*/*') || (owner && whitelist.includes(`${owner}/*`));
      if (!isAllowed) {
        return new Response(`该仓库不在白名单中: ${repoPath}`, { status: 403, headers: { "Content-Type": "text/plain" } });
      }
    } else {
      // 如果无法从URL中提取仓库路径，但白名单已启用，则默认拒绝
      if (!whitelist.includes('*/*')) {
         return new Response(`无法从URL确定仓库路径，访问被拒绝: ${targetUrlStr}`, { status: 403, headers: { "Content-Type": "text/plain" } });
      }
    }
  }
  
  // 转发请求到GitHub
  try {
    const cleanHeaders = new Headers();
    if (request.headers.get('accept')) cleanHeaders.set('accept', request.headers.get('accept'));
    if (request.headers.get('accept-language')) cleanHeaders.set('accept-language', request.headers.get('accept-language'));
    if (request.headers.get('content-type')) cleanHeaders.set('content-type', request.headers.get('content-type'));
    cleanHeaders.set('User-Agent', 'Cloudflare-Pages-GitHub-Proxy/2.0');
    
    const githubRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers: cleanHeaders,
      body: request.body,
      redirect: "follow",
    });
    
    const githubResponse = await fetch(githubRequest);
    
    const responseHeaders = new Headers(githubResponse.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(githubResponse.body, {
      status: githubResponse.status,
      statusText: githubResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(`代理到GitHub时出错: ${error.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
}

/**
 * 从不同格式的GitHub URL中提取 'owner/repo' 路径
 */
function getRepoPathFromUrl(targetUrl) {
    const pathParts = targetUrl.pathname.split('/').filter(Boolean);
    
    if (targetUrl.hostname === "github.com" && pathParts.length >= 2) {
      return `${pathParts[0]}/${pathParts[1]}`;
    }
    if (targetUrl.hostname === "raw.githubusercontent.com" && pathParts.length >= 2) {
      return `${pathParts[0]}/${pathParts[1]}`;
    }
    if (targetUrl.hostname === "api.github.com" && pathParts.length >= 3 && pathParts[0] === "repos") {
      return `${pathParts[1]}/${pathParts[2]}`;
    }
    return null; // 对于gist等其他域名，不提取路径
}

/**
 * 从环境变量中获取白名单
 */
function getWhitelistFromEnv(env) {
  const whitelist = [];
  if (env && env.GITHUB_WHITELIST) {
    const whitelistStr = env.GITHUB_WHITELIST;
    const whitelistItems = whitelistStr.split(/,|，/).map(item => item.trim()).filter(Boolean);
    whitelist.push(...whitelistItems);
  }
  return whitelist;
}