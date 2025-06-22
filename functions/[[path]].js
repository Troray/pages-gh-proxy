/**
 * GitHub代理服务器
 * 基于Cloudflare Pages Functions环境
 * 
 * 功能：
 * 1. 代理GitHub相关域名的请求
 * 2. 支持通过环境变量设置白名单
 * 3. 支持ping检查和根路径说明
 * 4. 兼容被代理压缩的URL (https:/ -> https://)
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
  
  // 根路径或ping请求
  if (url.pathname === "/" || url.pathname === "/ping") {
    return new Response("GitHub Proxy is running.\nUsage: " + url.origin + "/https://github.com/user/repo", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  
  // 添加调试端点
  if (url.pathname === "/debug") {
    const whitelist = getWhitelistFromEnv(env);
    return new Response(JSON.stringify({
      env: env ? Object.keys(env) : [],
      GITHUB_WHITELIST: env?.GITHUB_WHITELIST || "未设置",
      whitelist: whitelist,
      whitelistLength: whitelist.length
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
  
  // 提取目标GitHub URL
  let pathWithoutLeadingSlash = url.pathname.substring(1);
  let targetUrl;
  
  // 处理本地代理可能压缩 'https://' 为 'https:/' 的情况
  if (pathWithoutLeadingSlash.startsWith("https:/") && !pathWithoutLeadingSlash.startsWith("https://")) {
    targetUrl = "https://" + pathWithoutLeadingSlash.substring(6); // 重建 URL
  } else if (pathWithoutLeadingSlash.startsWith("https://")) {
    targetUrl = pathWithoutLeadingSlash; // 标准情况
  } else {
    // URL格式不正确
    return new Response("无效的URL格式。URL必须以 /https://... 格式提供。收到的路径: " + url.pathname, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  
  // 解析目标URL
  const targetUrlObj = new URL(targetUrl);
  
  // 检查是否是GitHub域名
  if (!GITHUB_DOMAINS.includes(targetUrlObj.hostname)) {
    return new Response("仅支持GitHub相关域名", {
      status: 403,
      headers: { "Content-Type": "text/plain" }
    });
  }
  
  // 从环境变量中获取白名单
  const whitelist = getWhitelistFromEnv(env);
  
  // 检查白名单 (如果有白名单设置)
  if (whitelist.length > 0) {
    let repoPath = "";
    
    if (targetUrlObj.hostname === "github.com") {
      const pathParts = targetUrlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        repoPath = `${pathParts[0]}/${pathParts[1]}`;
      }
    } else if (targetUrlObj.hostname === "raw.githubusercontent.com") {
      const pathParts = targetUrlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        repoPath = `${pathParts[0]}/${pathParts[1]}`;
      }
    } else if (targetUrlObj.hostname === "api.github.com") {
      const pathParts = targetUrlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 3 && pathParts[0] === "repos") {
        repoPath = `${pathParts[1]}/${pathParts[2]}`;
      }
    } else if (targetUrlObj.hostname === "gist.github.com") {
      if (!whitelist.includes("*/*") && !whitelist.includes("gist/*")) {
        return new Response("该仓库不在白名单中", { status: 403, headers: { "Content-Type": "text/plain" } });
      }
    }
    
    if (repoPath) {
      const [owner] = repoPath.split('/');
      const isAllowed = whitelist.includes(repoPath) || whitelist.includes('*/*') || (owner && whitelist.includes(`${owner}/*`));
      if (!isAllowed) {
        return new Response(`该仓库不在白名单中: ${repoPath}`, { status: 403, headers: { "Content-Type": "text/plain" } });
      }
    }
  }
  
  // 转发请求到GitHub
  try {
    const cleanHeaders = new Headers();
    if (request.headers.get('accept')) cleanHeaders.set('accept', request.headers.get('accept'));
    if (request.headers.get('accept-language')) cleanHeaders.set('accept-language', request.headers.get('accept-language'));
    if (request.headers.get('content-type')) cleanHeaders.set('content-type', request.headers.get('content-type'));
    cleanHeaders.set('User-Agent', 'Cloudflare-Pages-GitHub-Proxy/1.0');
    
    const githubRequest = new Request(targetUrl, {
      method: request.method,
      headers: cleanHeaders,
      body: request.body,
      redirect: "follow",
    });
    
    const githubResponse = await fetch(githubRequest);
    
    if (githubResponse.status === 404) {
      const debugInfo = {
        message: "GitHub API 返回 404. 请确认目标 URL 是否正确，以及仓库是否为公开可见。",
        targetUrl: targetUrl,
        githubResponse: { status: githubResponse.status, statusText: githubResponse.statusText },
        requestHeadersSent: Object.fromEntries(cleanHeaders.entries())
      };
      return new Response(JSON.stringify(debugInfo, null, 2), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    
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
    console.error("代理到GitHub时出错:", error);
    return new Response(`代理到GitHub时出错: ${error.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    });
  }
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