use std::fs;
use std::path::Path;

use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::lock_utils::read_lock;

use super::helpers::{can_access_document_path, start_security_bookmark_access};
use crate::app::state::AppState;

// ==================== 鍩熷唴 helper ====================

pub(crate) mod attachment_audit;
mod attachments;
mod base64_input;
pub(crate) mod upload_journal;
mod upload_quota;
pub(crate) mod upload_sessions;

// ==================== IPC: 鍘熺敓 dialog ====================

#[tauri::command]
pub async fn select_directory(app: tauri::AppHandle) -> Option<String> {
    use std::sync::mpsc;
    #[cfg(not(target_os = "macos"))]
    use tauri_plugin_dialog::DialogExt;
    #[cfg(not(target_os = "macos"))]
    use tokio::task;

    let (tx, rx) = mpsc::channel();

    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let state_handle = handle.clone();
        handle
            .run_on_main_thread(move || {
                let result = crate::config::pick_directory_with_bookmark("选择笔记本文件夹").map(
                    |(path, bookmark)| {
                        let state = state_handle.state::<AppState>();
                        if let Err(e) = state
                            .security_bookmarks
                            .record_directory_bookmark(Path::new(&path), bookmark)
                        {
                            tracing::warn!("[select_directory] failed to persist bookmark: {e}");
                        }
                        path
                    },
                );
                tx.send(result).ok();
            })
            .ok()?;
        return tokio::task::spawn_blocking(move || rx.recv().ok().flatten())
            .await
            .ok()
            .flatten();
    }

    #[cfg(not(target_os = "macos"))]
    // Run blocking dialog in a background thread to avoid freezing the UI
    let handle = app.clone();
    #[cfg(not(target_os = "macos"))]
    task::spawn_blocking(move || {
        let result = handle
            .dialog()
            .file()
            .set_title("选择笔记本文件夹")
            .blocking_pick_folder()
            .map(|p| p.to_string());
        tx.send(result).ok();
    });

    #[cfg(not(target_os = "macos"))]
    tokio::task::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn select_files(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    accept: Option<String>,
) -> Option<Vec<String>> {
    let generation = app
        .state::<AppState>()
        .document_access
        .generation(window.label());
    use tauri_plugin_dialog::DialogExt;
    use tokio::task;

    let handle = app.clone();
    task::spawn_blocking(move || {
        let dialog = handle.dialog().file().set_title("选择文件");
        let dialog = match accept.as_deref() {
            Some("image/*") => dialog.add_filter(
                "图片",
                &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"],
            ),
            Some("video/*") => {
                dialog.add_filter("视频", &["mp4", "webm", "mov", "avi", "mkv", "ogg"])
            }
            _ => dialog.add_filter(
                "Attachments",
                &[
                    "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "doc", "docx", "xls",
                    "xlsx", "ppt", "pptx", "txt", "md", "csv", "json", "mp3", "wav", "ogg", "mp4",
                    "webm", "mov", "avi", "zip", "rar", "7z", "tar", "gz",
                ],
            ),
        };
        let result = dialog
            .add_filter("All files", &["*"])
            .blocking_pick_files()
            .map(|paths| {
                paths
                    .into_iter()
                    .filter_map(|path| {
                        let path = path.to_string();
                        handle
                            .state::<AppState>()
                            .document_access
                            .grant_for_generation(window.label(), generation, Path::new(&path))
                            .then_some(path)
                    })
                    .collect::<Vec<String>>()
            });
        result
    })
    .await
    .ok()
    .flatten()
}

fn picgo_uploaded_url(value: &serde_json::Value) -> Result<String, String> {
    if value.get("success").is_some_and(|success| success == false) {
        return Err("PICGO_UPLOAD_FAILED".to_string());
    }
    let url = value
        .get("result")
        .and_then(|result| result.as_array())
        .and_then(|result| result.first())
        .and_then(|url| url.as_str())
        .or_else(|| {
            value
                .get("items")
                .and_then(|items| items.as_array())
                .and_then(|items| items.first())
                .and_then(|item| item.get("imgUrl"))
                .and_then(|url| url.as_str())
        })
        .ok_or_else(|| "PICGO_UPLOAD_FAILED".to_string())?;
    let parsed = reqwest::Url::parse(url).map_err(|_| "PICGO_UPLOAD_FAILED".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err("PICGO_UPLOAD_FAILED".to_string());
    }
    Ok(url.to_string())
}

/// Explicit image-host upload. Local insertion still uses relative paths by
/// default; this command is only called after the user picks "Upload to PicGo".
#[tauri::command]
pub async fn upload_image_to_picgo(
    source_path: String,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = dunce::canonicalize(&source_path).map_err(|_| "PICGO_INVALID_IMAGE".to_string())?;
    let is_image = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
            )
        });
    if !path.is_file() || !is_image || !can_access_document_path(&path, window.label(), &state) {
        return Err("PICGO_INVALID_IMAGE".to_string());
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|_| "PICGO_UNAVAILABLE".to_string())?;
    let response = client
        .post("http://127.0.0.1:36677/upload")
        .json(&serde_json::json!({ "list": [path.to_string_lossy()] }))
        .send()
        .await
        .map_err(|_| "PICGO_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("PICGO_UPLOAD_FAILED".to_string());
    }
    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "PICGO_UPLOAD_FAILED".to_string())?;
    picgo_uploaded_url(&value)
}

#[cfg(test)]
mod picgo_tests {
    use super::picgo_uploaded_url;

    #[test]
    fn accepts_picgo_upload_response_and_rejects_non_web_urls() {
        let response = serde_json::json!({"success": true, "result": ["https://images.example/note.png"]});
        assert_eq!(picgo_uploaded_url(&response).unwrap(), "https://images.example/note.png");
        let unsafe_response = serde_json::json!({"success": true, "result": ["javascript:alert(1)"]});
        assert!(picgo_uploaded_url(&unsafe_response).is_err());
    }
}

#[tauri::command]
pub async fn save_file_dialog(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    suggested_name: Option<String>,
    filters: Option<Vec<Vec<String>>>,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::task;

    let handle = app.clone();
    let suggested = suggested_name.unwrap_or_else(|| "Untitled".to_string());
    let filter_list = filters.unwrap_or_default();
    app.state::<AppState>().export_access.revoke(window.label());
    let generation = app
        .state::<AppState>()
        .export_access
        .generation(window.label());

    task::spawn_blocking(move || {
        let mut builder = handle
            .dialog()
            .file()
            .set_title("保存文件")
            .set_file_name(&suggested);

        for filter in &filter_list {
            if filter.is_empty() {
                continue;
            }
            let name = filter[0].clone();
            let exts: Vec<&str> = filter.iter().skip(1).map(|s| s.as_str()).collect();
            if !exts.is_empty() {
                builder = builder.add_filter(&name, &exts);
            }
        }

        let result = builder.blocking_save_file().and_then(|path| {
            handle
                .state::<AppState>()
                .export_access
                .grant_for_generation(window.label(), generation, Path::new(&path.to_string()))
                .map(|path| path.to_string_lossy().into_owned())
        });
        result
    })
    .await
    .ok()
    .flatten()
}

// ==================== IPC: 闄勪欢淇濆瓨 ====================

#[tauri::command]
pub async fn save_attachment(
    window: tauri::WebviewWindow,
    source_path: String,
    notebook_id: Option<String>,
    memo_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let permit = upload_quota::UPLOAD_QUOTA.acquire()?;
    let source = Path::new(&source_path);
    start_security_bookmark_access(&state, source);
    let source = dunce::canonicalize(source).map_err(|error| error.to_string())?;
    if !super::helpers::can_access_document_path(&source, window.label(), &state) {
        return Err("Attachment source is not authorized".to_string());
    }
    if !source.is_file() {
        return Err("Attachment source is not a regular file".to_string());
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid file name")?
        .to_string();
    let mut reader = fs::File::open(&source).map_err(|error| error.to_string())?;
    let metadata = reader.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > attachments::MAX_ATTACHMENT_BYTES {
        return Err("ATTACHMENT_FILE_TOO_LARGE".to_string());
    }
    let root = {
        let store = read_lock(&state.memo_file, "memo_file");
        let owner =
            attachments::resolve_notebook_id(&store, notebook_id.as_deref(), memo_id.as_deref())
                .map_err(|error| error.to_string())?;
        attachments::notebook_root(&store, Some(&owner)).map_err(|error| error.to_string())?
    };
    start_security_bookmark_access(&state, &root);
    let memo_file = state.memo_file.clone();
    tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let _permit = permit;
        let store = read_lock(&memo_file, "memo_file");
        let path = attachments::save_for_owner(
            &store,
            notebook_id.as_deref(),
            memo_id.as_deref(),
            &name,
            &mut reader,
        )
        .map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn copy_attachment_file(
    window: tauri::WebviewWindow,
    source_path: String,
    target_path: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let source = attachments::authorized_attachment(
        &read_lock(&state.memo_file, "memo_file"),
        Path::new(&source_path),
    )
    .map_err(|error| error.to_string())?;
    let source = source.as_path();

    start_security_bookmark_access(&state, source);
    start_security_bookmark_access(&state, Path::new(&target_path));
    let mut reader = fs::File::open(source).map_err(|error| error.to_string())?;
    state
        .export_access
        .save(
            window.label(),
            Path::new(&target_path),
            &mut reader,
            &read_lock(&state.memo_file, "memo_file"),
        )
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn open_attachment_file(
    app: tauri::AppHandle,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let source = attachments::authorized_attachment(
        &read_lock(&state.memo_file, "memo_file"),
        Path::new(&source_path),
    )
    .map_err(|error| error.to_string())?;
    let source = source.as_path();

    start_security_bookmark_access(&state, source);
    app.opener()
        .open_path(source.display().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

// ==================== IPC: 瀵煎嚭 ====================

#[tauri::command]
pub fn write_export_file(
    window: tauri::WebviewWindow,
    file_path: String,
    content: String,
    state: State<'_, AppState>,
) -> bool {
    state
        .export_access
        .save(
            window.label(),
            Path::new(&file_path),
            &mut content.as_bytes(),
            &read_lock(&state.memo_file, "memo_file"),
        )
        .is_ok()
}
