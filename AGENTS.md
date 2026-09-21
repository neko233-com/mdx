<!-- flowix:instructions:start -->
## Flowix CLI

Flowix 是用于操作笔记和插件产物的非交互式 CLI，使用 `--json` 时返回 JSON。

只在显式触发时调：用户说“搜/列/改/删/新建笔记”，或给了 8 位 ID / 笔记本名要求“看/改/删”。
如果上下文包含当前任务标签，创建新笔记时必须在正文写入该 #标签。

- `flowix notebooks` — 列出所有笔记本
- `flowix list <notebook>` — 列出指定笔记本中的笔记
- `flowix show <id>` — 查看指定笔记
- `flowix search <query> [-b <notebook>] [-l N]` — 全文搜索
- `flowix edit <id> --old <text> --new <text>` — 精确替换文本，修改前必须先读取
- `flowix write <id>`（正文从 stdin 传入）— 覆盖笔记正文
- `flowix create <notebook>`（正文从 stdin 传入）— 创建新笔记
- `flowix delete <id>` — 删除笔记
- `flowix plugin create mindmap --notebook <name|id|path> [--source-note <id|path>] --json` — 从 stdin 读取最终 Markmap Markdown 并创建 Flowix 思维导图文档

仅当用户明确要求生成/创建思维导图时调用 mindmap 工具。调用前先整理最终 Markdown：

- 恰好一个一级根标题；
- 分支使用二/三级标题和无序列表；
- 不要手工创建 `.plugin-output` 文件；
- 成功后向用户返回 `title` 和 `noteId`。

## 工作空间范围

当前 agent 可访问的工作空间路径：

- 当前笔记本：/Users/rop/Desktop/vibe/flowix-main
- 资料文件夹：
  - /Users/rop/.flowix/skills
  - /Users/rop/Desktop/vibe/flowix-home
  - /Users/rop/Documents/flowix/test
<!-- flowix:instructions:end -->
