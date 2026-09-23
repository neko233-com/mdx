# MDX

![MDX icon](assets/mdx-icon.png)

MDX is a local Markdown editor for Windows and macOS, with Typora as its writing and interaction reference: a file tree on the left, a WYSIWYG document on the right, and a Typora GitHub style light palette. Inserted local images use document-relative paths by default; remote image-host URLs also work. The note storage and editor core are based on [Flowix](https://github.com/text2future/flowix). It uses a Rust/Tauri backend and a React/Tiptap renderer; GPUI is not used in this version.

## Install

Download the current Windows NSIS installer or macOS app from [Releases](https://github.com/neko233-com/mdx/releases). A release is needed before the commands below work.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.ps1 | iex
```

If GitHub itself cannot be reached:

```powershell
irm https://ghproxy.net/https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.ps1 | iex
```

macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.sh | sh
```

Mirror entry point:

```sh
curl -fsSL https://ghproxy.net/https://raw.githubusercontent.com/neko233-com/mdx/main/scripts/install.sh | sh
```

The installers try GitHub first and then [ghproxy.net](https://ghproxy.net/) if GitHub is unreachable. This is a third-party mirror; use the official release when possible. Set `MDX_DOWNLOAD_SOURCE=mirror` and optionally `MDX_MIRROR_BASE=https://your-mirror.example` for the macOS script. The PowerShell script accepts `-Source mirror -MirrorBase https://your-mirror.example` when run from a saved file. The desktop updater checks the mirrored manifest first, so a GitHub connection timeout does not prevent users from checking for updates. GitHub is the secondary endpoint. Update artifacts are verified by Tauri's built-in public key before installation.

Automatic update checking and installation are enabled by default. Turn them off in Preferences → General → Install updates automatically. The app registers `.md` and `.markdown` as supported document types. On Windows, Preferences → General → Default Markdown app opens the system page where you can assign both extensions to MDX. On macOS, use Finder → Get Info → Open with → MDX → Change All.

## Build

Requires Node.js 20+, npm, the Rust toolchain, and the [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run cli:build:dev
npm run build
cargo check --manifest-path app/Cargo.toml -p flowix-desktop
```

The CLI executable is `mdx-cli`; the install scripts also create an `mdx` command. On macOS, open a new terminal after installation to pick up the PATH change. Agents can read and edit local Markdown notes through the CLI or the stdio MCP server (`mdx mcp`). The desktop app has no built-in chat interface. MDX stores user settings in `~/.mdx` and notebook metadata in each notebook's `.mdx` folder.

Local images stay local and use document-relative Markdown paths by default. For an explicit image-host upload, configure [PicGo](https://github.com/PicGo/PicGo-Core) with your chosen provider, start its local server on `127.0.0.1:36677`, and choose **Upload image to host (PicGo)** from the editor's insert menu. MDX sends only the selected image to that local service and inserts the returned URL; it does not upload images when you paste or insert them normally.

## Upstream and license

MDX is derived from Flowix by text2future under the MIT license. The original copyright and license remain in [LICENSE](LICENSE), and the upstream Git history is preserved. Cloud sync and the optional DeepSeek Harness integration originate upstream and are not part of the local note release acceptance.
