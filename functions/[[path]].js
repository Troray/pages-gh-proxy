/**
 * GitHub代理服务器 (v3 - Ultimate Compatibility Mode)
 * 基于Cloudflare Pages Functions环境
 * 
 * 功能：
 * 1. 支持路径嵌套模式 /https://github.com/user/repo
 * 2. 智能兼容被代理修改过的URL (https:/... 和 github.com/...)
 * 3. 支持通过环境变量设置白名单
 * 4. 根路径提供清晰的用法说明
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
  
  if (url.pathname === "/" || url.pathname === "/ping") {
    const usage = `GitHub Proxy is running.\nUsage: ${url.origin}/https://github.com/user/repo`;
    return new Response(usage, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  // --- 智能URL重建逻辑 ---
  let pathWithoutLeadingSlash = url.pathname.substring(1);
  let targetUrlStr;

  // 1. 标准情况
  if (pathWithoutLeadingSlash.startsWith("https://")) {
    targetUrlStr = pathWithoutLeadingSlash;
  } 
  // 2. 兼容被压缩的URL: https:/...
  else if (pathWithoutLeadingSlash.startsWith("https:/") && !pathWithoutLeadingSlash.startsWith("https://")) {
    targetUrlStr = "https://" + pathWithoutLeadingSlash.substring(6);
  } 
  // 3. 兼容被移除协议的URL: github.com/...
  else if (GITHUB_DOMAINS.some(domain => pathWithoutLeadingSlash.startsWith(domain))) {
     targetUrlStr = "https://" + pathWithoutLeadingSlash;
  }
  // 4. 所有情况都不匹配
  else {
    const errorMsg = `无效的URL格式。URL必须以 /https://... 格式提供。
收到的路径: ${url.pathname}
智能重建失败。`;
    return new Response(errorMsg, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
  
  // --- 后续逻辑与之前相同 ---

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (e) {
    return new Response(`重建后的URL无效: ${targetUrlStr}`, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (!GITHUB_DOMAINS.includes(targetUrl.hostname)) {
    return new Response("仅支持GitHub相关域名", { status: 403, headers: { "Content-Type": "text/plain" } });
  }
  
  const whitelist = getWhitelistFromEnv(env);
  
  if (whitelist.length > 0) {
    let repoPath = getRepoPathFromUrl(targetUrl);
    
    if (repoPath) {
      const [owner] = repoPath.split('/');
      const isAllowed = whitelist.includes(repoPath) || whitelist.includes('*/*') || (owner && whitelist.includes(`${owner}/*`));
      if (!isAllowed) {
        return new Response(`该仓库不在白名单中: ${repoPath}`, { status: 403, headers: { "Content-Type": "text/plain" } });
      }
    } else {
      if (!whitelist.includes('*/*')) {
         return new Response(`无法从URL确定仓库路径，访问被拒绝: ${targetUrlStr}`, { status: 403, headers: { "Content-Type": "text/plain" } });
      }
    }
  }
  
  try {
    const cleanHeaders = new Headers();
    if (request.headers.get('accept')) cleanHeaders.set('accept', request.headers.get('accept'));
    if (request.headers.get('accept-language')) cleanHeaders.set('accept-language', request.headers.get('accept-language'));
    if (request.headers.get('content-type')) cleanHeaders.set('content-type', request.headers.get('content-type'));
    cleanHeaders.set('User-Agent', 'Cloudflare-Pages-GitHub-Proxy/3.0');
    
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
    return new Response(`代理到GitHub时出错: ${error.message}`, { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

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
    return null;
}

function getWhitelistFromEnv(env) {
  const whitelist = [];
  if (env && env.GITHUB_WHITELIST) {
    const whitelistStr = env.GITHUB_WHITELIST;
    const whitelistItems = whitelistStr.split(/,|，/).map(item => item.trim()).filter(Boolean);
    whitelist.push(...whitelistItems);
  }
  return whitelist;
}