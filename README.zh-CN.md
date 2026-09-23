# MDX

![MDX 图标](assets/mdx-icon.png)

MDX 是 Windows、macOS 本地 Markdown 编辑器，以 Typora 的写作界面和交互为参考：左侧文件树、右侧所见即所得文档，默认使用接近 Typora GitHub 主题的配色。粘贴或插入本地图片时优先保存相对路径；远程图床图片 URL 也可直接使用。笔记存储与编辑核心基于 [Flowix](https://github.com/text2future/flowix)，桌面后端采用 Rust/Tauri，界面采用 React/Tiptap；当前未采用 GPUI。

## 安装

可以从 [Releases](https://github.com/neko233-com/mdx/releases) 下载 Windows NSIS 安装包或 macOS 应用。下列命令需要先发布版本。

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.ps1 | iex
```

GitHub 入口无法访问时：

```powershell
irm https://ghproxy.net/https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.ps1 | iex
```

macOS：

```sh
curl -fsSL https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.sh | sh
```

镜像入口：

```sh
curl -fsSL https://ghproxy.net/https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.sh | sh
```

安装脚本先访问 GitHub，失败后尝试 [ghproxy.net](https://ghproxy.net/) 镜像。该镜像由第三方提供，能访问官方发布页时优先使用官方版本。macOS 可设置 `MDX_DOWNLOAD_SOURCE=mirror`、`MDX_MIRROR_BASE=https://your-mirror.example`；PowerShell 下载脚本到本地后可使用 `-Source mirror -MirrorBase https://your-mirror.example`。桌面应用也有 GitHub 与镜像更新清单回退。Tauri 会使用内置公钥校验更新包签名。

自动检查和安装更新默认开启，可在“偏好设置 → 通用 → 自动安装更新”关闭。应用注册 `.md`、`.markdown` 文件类型；设置系统默认编辑器仍需用户在 Windows 设置或 macOS Finder 中选择。

## 开发

需要 Node.js 20+、npm、Rust 和 [Tauri v2 平台依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run cli:build:dev
npm run build
cargo check --manifest-path app/Cargo.toml -p flowix-desktop
```

命令行二进制为 `mdx-cli`，安装脚本会创建 `mdx` 命令；macOS 安装后请打开新终端使 PATH 生效。Agent 可通过 CLI 或 `mdx mcp` 读写本地 Markdown 笔记；桌面端不提供内置对话界面。用户配置保存在 `~/.mdx`，笔记本元数据在笔记本目录的 `.mdx` 下。

## 来源与许可

MDX 基于 text2future 的 Flowix MIT 源码开发，保留了 [LICENSE](LICENSE) 中原作者版权和上游 Git 历史。云同步、可选 DeepSeek Harness 集成来自上游，未纳入本地笔记版本验收。
