# MDX development notes

- Desktop targets are Windows and macOS. The Rust workspace is in `app/`; the React/Tiptap renderer is in `app/flowix-web/`.
- Every installer run refreshes one MDX desktop launch icon idempotently. Use the packaged MDX logo on Windows and macOS, and preserve unrelated desktop items.
- This is an MIT-licensed derivative of Flowix. Keep its copyright notice, license, and upstream attribution.
- Typora is the complete interaction and visual reference: a Markdown file tree on the left, a focused WYSIWYG document on the right, restrained controls, and Typora-like colors. Flowix supplies the local storage and editor core, not the product interaction contract.
- Inserted local images use document-relative Markdown paths by default so moving a notebook preserves them. Keep existing absolute asset links readable; remote image URLs remain usable for image hosts. PicGo upload is an explicit editor action; never upload pasted images by default or rewrite a user's existing Markdown just because it was opened.
- A newly created empty notebook stays empty. Do not seed Flowix welcome or agent marketing documents.
- Do not expose an in-app conversation/chat surface. Agent access is through the `mdx` CLI and MCP integration for reading and editing Markdown; keep those settings discoverable.
- Default to the folder tree view. Preserve existing explicit user view choices and keep other themes functional.
- CLI executable: `mdx-cli`; user command: `mdx`; user config: `~/.mdx`; notebook metadata: `.mdx`.
- Never commit the updater signing private key. The local copy stays in the user's profile. Build and sign Windows/macOS packages locally, then manually upload them to GitHub Releases; do not use GitHub Actions for packaging. The desktop updater checks the mirrored manifest first so a GitHub timeout does not block updates.
- Build the CLI sidecar before building the desktop app: `npm run cli:build:dev`, then `npm run build` and `cargo check --manifest-path app/Cargo.toml -p flowix-desktop`.
- Do not claim macOS packaging or system default app selection was verified by a Windows-only check.
