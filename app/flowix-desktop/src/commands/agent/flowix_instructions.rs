//! Project-local instructions shared with runtimes that natively load
//! `AGENTS.md` from their working directory.

use std::fs;
use std::path::Path;

const MANAGED_START: &str = "<!-- flowix:instructions:start -->";
const MANAGED_END: &str = "<!-- flowix:instructions:end -->";

const FLOWIX_INSTRUCTIONS: &str = r#"## Flowix CLI

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
- 成功后向用户返回 `title` 和 `noteId`。"#;

fn workspace_scope(cwd: &Path, workspace_paths: &[String]) -> String {
    let cwd = cwd.display().to_string();
    let mut folders = Vec::new();
    for raw in workspace_paths {
        let path = raw.trim();
        if path.is_empty() || path == cwd {
            continue;
        }
        if !folders.iter().any(|existing: &String| existing == path) {
            folders.push(path.to_string());
        }
    }

    let mut section = String::from("## 工作空间范围\n\n");
    section.push_str("当前 agent 可访问的工作空间路径：\n\n");
    section.push_str(&format!("- 当前笔记本：{cwd}\n"));
    if folders.is_empty() {
        section.push_str("- 资料文件夹：无额外文件夹\n");
    } else {
        section.push_str("- 资料文件夹：\n");
        for folder in folders {
            section.push_str(&format!("  - {folder}\n"));
        }
    }
    section
}

/// Synchronize Flowix's stable CLI rules and workspace scope into the project-local AGENTS file.
///
/// The operation is intentionally idempotent. Existing user-authored content
/// is preserved, while only the marked Flowix section is replaced. The caller
/// must invoke this before creating or resuming the provider session so native
/// AGENTS loaders observe the current rules during their baseline load.
pub(crate) fn sync_native_agent_instructions(
    cwd: &Path,
    agent_type: &str,
    workspace_paths: &[String],
) -> Result<(), String> {
    if !matches!(agent_type, "codex" | "deepseek-harness") {
        return Ok(());
    }
    if !cwd.is_dir() {
        return Err(format!(
            "cannot initialize Flowix AGENTS.md: working directory is unavailable: {}",
            cwd.display()
        ));
    }

    let path = cwd.join("AGENTS.md");
    if !crate::config::path_is_inside(&path, cwd) {
        return Err(format!(
            "refusing to initialize AGENTS.md outside the working directory: {}",
            path.display()
        ));
    }

    let existing = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("failed to read {}: {error}", path.display())),
    };
    let updated = upsert_managed_section(&existing, cwd, workspace_paths)?;
    if updated == existing {
        return Ok(());
    }

    flowix_core::memo_file::atomic_write_bytes(&path, updated.as_bytes())
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn managed_section(cwd: &Path, workspace_paths: &[String]) -> String {
    format!(
        "{MANAGED_START}\n{FLOWIX_INSTRUCTIONS}\n\n{}\n{MANAGED_END}",
        workspace_scope(cwd, workspace_paths).trim_end()
    )
}

fn marker_count(content: &str, marker: &str) -> usize {
    content.match_indices(marker).count()
}

fn upsert_managed_section(
    existing: &str,
    cwd: &Path,
    workspace_paths: &[String],
) -> Result<String, String> {
    let start_count = marker_count(existing, MANAGED_START);
    let end_count = marker_count(existing, MANAGED_END);
    if start_count > 1 || end_count > 1 || start_count != end_count {
        return Err(
            "AGENTS.md contains an invalid or duplicated Flowix instruction section".to_string(),
        );
    }

    let section = managed_section(cwd, workspace_paths);
    if start_count == 1 {
        let start = existing
            .find(MANAGED_START)
            .expect("marker count guarantees start marker");
        let end = existing
            .find(MANAGED_END)
            .expect("marker count guarantees end marker");
        if end < start {
            return Err("AGENTS.md contains reversed Flowix instruction markers".to_string());
        }
        let after = end + MANAGED_END.len();
        let prefix = existing[..start].trim_end();
        let suffix = existing[after..].trim_start();
        return Ok(join_sections(prefix, &section, suffix));
    }

    if existing.trim().is_empty() {
        Ok(format!("{section}\n"))
    } else {
        Ok(join_sections(existing.trim_end(), &section, ""))
    }
}

fn join_sections(prefix: &str, section: &str, suffix: &str) -> String {
    let mut result = String::new();
    if !prefix.is_empty() {
        result.push_str(prefix);
        result.push_str("\n\n");
    }
    result.push_str(section);
    if !suffix.is_empty() {
        result.push_str("\n\n");
        result.push_str(suffix);
    }
    result.push('\n');
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_managed_section_without_user_content() {
        let result = upsert_managed_section("", Path::new("/notes/current"), &[]).unwrap();
        assert!(result.starts_with(MANAGED_START));
        assert!(result.contains("flowix notebooks"));
        assert!(result.contains("flowix plugin create mindmap"));
        assert!(result.contains("8 位 ID / 笔记本名"));
        assert!(result.contains("## 工作空间范围"));
        assert!(result.contains("当前笔记本：/notes/current"));
        assert!(result.ends_with('\n'));
    }

    #[test]
    fn preserves_user_content_when_adding_section() {
        let result = upsert_managed_section(
            "# My project\n\nUse Rust.\n",
            Path::new("/notes/current"),
            &["/projects/app".to_string()],
        )
        .unwrap();
        assert!(result.starts_with("# My project\n\nUse Rust."));
        assert!(result.contains(MANAGED_START));
        assert!(result.contains("资料文件夹：\n  - /projects/app"));
        assert!(result.ends_with('\n'));
    }

    #[test]
    fn replaces_only_the_managed_section() {
        let existing =
            format!("# Before\n\n{MANAGED_START}\nold rules\n{MANAGED_END}\n\n# After\n");
        let result = upsert_managed_section(&existing, Path::new("/notes/current"), &[]).unwrap();
        assert!(result.contains("# Before"));
        assert!(result.contains("# After"));
        assert!(!result.contains("old rules"));
        assert_eq!(marker_count(&result, MANAGED_START), 1);
        assert_eq!(marker_count(&result, MANAGED_END), 1);
    }

    #[test]
    fn rejects_malformed_markers() {
        assert!(
            upsert_managed_section(
                &format!("{MANAGED_START}\nonly start"),
                Path::new("/notes"),
                &[],
            )
            .is_err()
        );
        assert!(
            upsert_managed_section(
                &format!("{MANAGED_START}\none\n{MANAGED_END}\n{MANAGED_END}"),
                Path::new("/notes"),
                &[],
            )
            .is_err()
        );
    }

    #[test]
    fn sync_is_idempotent_for_native_agents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("AGENTS.md");

        sync_native_agent_instructions(directory.path(), "codex", &[]).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        sync_native_agent_instructions(directory.path(), "deepseek-harness", &[]).unwrap();
        let second = std::fs::read_to_string(&path).unwrap();

        assert_eq!(first, second);
        assert_eq!(marker_count(&second, MANAGED_START), 1);
        assert_eq!(marker_count(&second, MANAGED_END), 1);
    }

    #[test]
    fn sync_refreshes_the_workspace_scope() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("AGENTS.md");

        sync_native_agent_instructions(
            directory.path(),
            "codex",
            &["/projects/one".to_string(), "/projects/two".to_string()],
        )
        .unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        assert!(first.contains("当前笔记本："));
        assert!(first.contains("  - /projects/one"));
        assert!(first.contains("  - /projects/two"));

        sync_native_agent_instructions(
            directory.path(),
            "codex",
            &["/projects/changed".to_string()],
        )
        .unwrap();
        let second = std::fs::read_to_string(path).unwrap();
        assert!(second.contains("  - /projects/changed"));
        assert!(!second.contains("  - /projects/one"));
    }

    #[test]
    fn unsupported_agents_do_not_create_project_instructions() {
        let directory = tempfile::tempdir().unwrap();

        sync_native_agent_instructions(directory.path(), "claude", &[]).unwrap();

        assert!(!directory.path().join("AGENTS.md").exists());
    }
}
