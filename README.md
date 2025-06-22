# Cloudflare Pages GitHub 代理

这是一个部署在 Cloudflare Pages 上的高性能 GitHub 代理。它允许你通过自己的域名访问 GitHub 的各种资源，同时提供了仓库白名单功能以增强安全性。

## ✨ 功能

- **多域名代理**: 支持代理 
```
github.com, 
raw.githubusercontent.com, 
api.github.com, 
gist.github.com, 
objects.githubusercontent.com, 
github.githubassets.com, 
camo.githubusercontent.com
```
等多个 GitHub 核心域名。
- **URL 兼容**: 使用 `https://你的域名/?url=https://github.com/user/repo` 的格式进行访问。
- **安全白名单**: 可以配置一个仓库白名单，只有名单内的仓库才能通过 `github.com` 被访问。
- **重定向跟随**: 自动重写 HTTP 301/302 重定向，确保所有流量都通过代理。
- **边缘计算**: 基于 Cloudflare 的全球边缘网络，延迟低，速度快。

## 🚀 部署

1.  **Fork 本项目**: 如果你是在 GitHub 上看到这个项目，请点击右上角的 "Fork" 按钮。如果是本地代码，请将其推送到你自己的 GitHub 仓库。
2.  **登录 Cloudflare**: 前往 [Cloudflare 控制台](https://dash.cloudflare.com/)。
3.  **创建 Pages 项目**:
    - 在首页，点击 "Workers & Pages"。
    - 选择 "创建应用程序" -> "Pages" -> "连接到 Git"。
    - 选择你自己的 GitHub 仓库。
4.  **配置构建**:
    - **项目名称**: 自定义你的项目名称。
    - **生产分支**: 选择 `main`。
    - **构建设置**: Cloudflare 通常会自动检测到这是一个无需构建步骤的静态项目，所以你无需填写任何构建命令或输出目录。
    - 点击 "保存并部署"。
5.  **完成**: 等待部署完成后，你就可以通过 Cloudflare 提供的 `*.pages.dev` 域名或绑定你自己的域名来使用此代理了。

## ⚙️ 配置

所有配置都在 `functions/[[path]].js` 文件中完成。

### 配置仓库白名单

编辑 `functions/[[path]].js` 文件，找到 `WHITELIST` 常量：

```javascript
const WHITELIST = [
  // 在这里添加你想要放行的仓库，例如:
  // 'microsoft/vscode',
  // 'facebook/react',
  // 'your-github-username/your-repo'
];
```

将你需要代理的仓库按照 `'owner/repo'` 的格式添加到这个数组中。

**重要提示**:
- 如果 `WHITELIST` 数组为空 (`[]`)，则白名单功能**不生效**，所有 `github.com` 的仓库都可以被访问。
- 一旦 `WHITELIST` 数组中至少有一个仓库，该名单就会被强制执行，只有名单内的仓库可以访问。

## 💡 使用方法

假设你的 Cloudflare Pages 域名是 `my-proxy.pages.dev`。

- **访问 GitHub 仓库页面**:
  `https://my-proxy.pages.dev/?url=https://github.com/microsoft/vscode`

- **访问 Raw 文件**:
  `https://my-proxy.pages.dev/?url=https://raw.githubusercontent.com/microsoft/vscode/main/package.json`

- **访问 GitHub API**:
  `https://my-proxy.pages.dev/?url=https://api.github.com/repos/microsoft/vscode`

## ⚠️ 限制

本项目主要通过代理网络请求来实现功能，但它**不会**重写返回的 HTML/CSS/JS 文件内容中的 URL。这意味着：

- 如果一个从 `github.com` 返回的网页中包含了指向 `github.com` 的绝对路径链接，点击该链接将直接访问原始的 GitHub 网站，而不是继续通过你的代理。
- 对于获取原始文件（如 `git clone`、`raw` 文件下载）和 API 请求等场景，此代理工作得很好。但对于需要深度交互的网页浏览，体验可能会中断。
