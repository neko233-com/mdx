# MDX 手动发布

MDX 的安装包在 Windows 和 macOS 本机构建，上传到 GitHub Releases。推送 `main` 或 `v*` 标签不会启动 GitHub Actions 打包。`v0.1.7` 的自动任务已取消；在手动产物齐备并发布前，`v0.1.6` 仍是最新公开版本。

## 1. 本机构建

在干净的源码树上安装依赖，并从各自的操作系统运行：

```text
npm ci
npm run cli:build:dev
npm run build
cargo check --manifest-path app/Cargo.toml -p flowix-desktop --locked
```

将 Tauri updater 私钥保存在用户配置目录，通过 `TAURI_SIGNING_PRIVATE_KEY_PATH` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供给当前终端；不要把私钥或密码提交到仓库、写入发布说明或打印到日志。Windows 与 macOS 必须使用与 `tauri.conf.json` 中公钥配对的**同一把** updater 私钥。

Windows 用户目录已有 `~/.tauri/mdx.key`、`mdx.key.pub` 和 `mdx-password.dpapi` 时，运行 `pwsh -File scripts/build-mdx-windows.ps1`；脚本检查公钥并在当前构建进程中解密密码。macOS 在本机安全设置好上述两个环境变量后运行 `npm run tauri:build:prod`。

Windows 产物通常位于 `.build/cargo-target/release/bundle/nsis/`，包括 `MDX_<版本>_x64-setup.exe` 和同名 `.sig`。分别在 Apple Silicon 与 Intel macOS 上构建，收集各自的 `.app.tar.gz`、`.app.tar.gz.sig` 和 `.dmg`。macOS 对外分发还需在本机完成 Apple 签名、公证和 Gatekeeper 检查；Windows 本机检查不等于 macOS 验收。

## 2. 汇总资产并生成清单

将各机器的构建产物复制到同一临时目录，例如 `.build/manual-release/v0.1.7/`，统一为下列名称。`.sig` 必须与**同一次构建的对应包**配对；重命名包时也重命名其 `.sig`，不要重新生成或复用其他版本的签名。

```text
MDX_0.1.7_x64-setup.exe
MDX_0.1.7_x64-setup.exe.sig
MDX_0.1.7_aarch64.app.tar.gz
MDX_0.1.7_aarch64.app.tar.gz.sig
MDX_0.1.7_aarch64.dmg
MDX_0.1.7_x64.app.tar.gz
MDX_0.1.7_x64.app.tar.gz.sig
MDX_0.1.7_x64.dmg
```

运行：

```text
node scripts/prepare-mdx-manual-release.mjs .build/manual-release/v0.1.7
```

脚本在任一资产缺失、为空或版本不一致时失败；全部齐备后生成 `latest.json`、`latest-mirror.json` 和 `SHA256SUMS`。前两个清单分别指向 GitHub Release 与 `ghproxy.net` 镜像，保留现有自动更新和无法直连 GitHub 时的加速路径。

## 3. 手动上传与发布

在 GitHub 仓库的 Releases 页面以对应标签创建 **Draft**，手动上传目录内的 11 个文件：8 个安装/更新资产、2 个清单、1 个校验和文件。逐一核对文件名、版本与 `SHA256SUMS`。确认三个平台更新包、签名和清单全部到齐，再发布 Draft；不要发布仅包含单个平台的版本，否则 `/releases/latest/download/` 会指向不完整版本。

发布后分别检查 Windows 安装、macOS 两种架构安装和启动；用 `scripts/install.ps1 -Source mirror` 检查 Windows 镜像路径，用 `scripts/install.sh` 检查 macOS 安装路径。只有实际运行过的平台才记录为安装验收通过。
