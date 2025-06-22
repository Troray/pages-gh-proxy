/**
 * GitHub代理服务器
 * 基于Cloudflare Pages Functions环境
 * 
 * 功能：
 * 1. 代理GitHub相关域名的请求
 * 2. 支持通过环境变量设置白名单
 * 3. 支持ping检查
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
  
  // 检查是否是根路径访问或ping请求
  if (url.pathname === "/" || url.pathname === "/ping") {
    return new Response("pong", {
      status: 200,
      headers: { "Content-Type": "text/plain" }
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
      headers: { "Content-Type": "application/json" }
    });
  }
  
  // 提取目标GitHub URL
  const pathWithoutLeadingSlash = url.pathname.substring(1);
  let targetUrl;
  
  // 检查路径是否以https://开头
  if (pathWithoutLeadingSlash.startsWith("https://")) {
    targetUrl = pathWithoutLeadingSlash;
  } else {
    return new Response("无效的URL格式。请使用: https://你的域名/https://github.com/...", {
      status: 400,
      headers: { "Content-Type": "text/plain" }
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
  
  // 添加调试信息
  console.log("调试信息:", {
    targetUrl,
    hostname: targetUrlObj.hostname,
    whitelist,
    hasWhitelist: whitelist.length > 0
  });
  
  // 检查白名单 (如果有白名单设置)
  if (whitelist.length > 0) {
    // 从URL中提取用户名和仓库名
    // 分析不同的GitHub URL格式
    let repoPath = "";
    
    if (targetUrlObj.hostname === "github.com") {
      // https://github.com/用户名/仓库名
      const pathParts = targetUrlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        repoPath = `${pathParts[0]}/${pathParts[1]}`;
      }
    } else if (targetUrlObj.hostname === "raw.githubusercontent.com") {
      // https://raw.githubusercontent.com/用户名/仓库名/...
      const pathParts = targetUrlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        repoPath = `${pathParts[0]}/${pathParts[1]}`;
      }
    } else if (targetUrlObj.hostname === "api.github.com") {
      // https://api.github.com/repos/用户名/仓库名/...
      const pathParts = targetUrlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 3 && pathParts[0] === "repos") {
        repoPath = `${pathParts[1]}/${pathParts[2]}`;
      }
    } else if (targetUrlObj.hostname === "gist.github.com") {
      // Gist URLs处理方式不同，因为它们不遵循相同的模式
      // 对于gist.github.com，如果whitelist包含特殊条目，我们将允许所有访问
      if (!whitelist.includes("*/*") && !whitelist.includes("gist/*")) {
        return new Response("该仓库不在白名单中", {
          status: 403,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }
    
    // 添加调试信息
    console.log("白名单检查:", {
      repoPath,
      whitelist,
      isInWhitelist: whitelist.includes(repoPath),
      hasWildcard: whitelist.includes("*/*"),
      owner: repoPath ? repoPath.split('/')[0] : null,
      ownerWildcard: repoPath ? `${repoPath.split('/')[0]}/*` : null,
      hasOwnerWildcard: repoPath ? whitelist.includes(`${repoPath.split('/')[0]}/*`) : false
    });
    
    // 检查仓库是否在白名单中
    if (repoPath) {
      const [owner] = repoPath.split('/');
      const isAllowed = whitelist.includes(repoPath) ||
                        whitelist.includes('*/*') ||
                        (owner && whitelist.includes(`${owner}/*`));

      if (!isAllowed) {
        return new Response("该仓库不在白名单中", {
          status: 403,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }
  }
  
  // 转发请求到GitHub
  try {
    // 创建新的Request对象以转发
    const githubRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
    });
    
    console.log("转发请求到:", targetUrl);
    
    // 发送请求到GitHub
    const githubResponse = await fetch(githubRequest);
    
    console.log("GitHub响应:", {
      status: githubResponse.status,
      statusText: githubResponse.statusText,
      headers: Object.fromEntries(githubResponse.headers.entries())
    });
    
    // 创建响应对象
    const responseHeaders = new Headers(githubResponse.headers);
    
    // 转发响应给客户端
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
 * 环境变量格式：GITHUB_WHITELIST=repo1,repo2,repo3
 * 例如：GITHUB_WHITELIST=cloudflare/workers-sdk,AlistGo/alist,gist/*
 */
function getWhitelistFromEnv(env) {
  const whitelist = [];
  
  // 检查环境变量中是否有设置白名单
  if (env && env.GITHUB_WHITELIST) {
    // 分割环境变量值为数组 (同时支持半角和全角逗号)
    const whitelistStr = env.GITHUB_WHITELIST;
    const whitelistItems = whitelistStr.split(/,|，/).map(item => item.trim());
    
    // 添加到白名单数组
    whitelist.push(...whitelistItems);
  }
  
  return whitelist;
} 
