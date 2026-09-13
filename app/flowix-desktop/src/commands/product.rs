use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::runtime_log;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInfo {
    pub product_name: &'static str,
    pub version: &'static str,
    pub config_dir: String,
    pub data_dir: String,
    pub log_dir: String,
    pub os: &'static str,
    pub arch: &'static str,
}

fn product_info() -> ProductInfo {
    ProductInfo {
        product_name: runtime_log::PRODUCT_NAME,
        version: runtime_log::APP_VERSION,
        config_dir: runtime_log::user_config_dir().display().to_string(),
        data_dir: runtime_log::app_data_dir().display().to_string(),
        log_dir: runtime_log::log_dir().display().to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[tauri::command]
pub fn get_product_info() -> ProductInfo {
    product_info()
}

#[tauri::command]
pub fn get_diagnostics() -> String {
    let info = product_info();
    format!(
        "Product: {}\nVersion: {}\nOS: {}\nArch: {}\nConfig dir: {}\nData dir: {}\nLog dir: {}",
        info.product_name,
        info.version,
        info.os,
        info.arch,
        info.config_dir,
        info.data_dir,
        info.log_dir
    )
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = runtime_log::ensure_log_dir().map_err(|err| err.to_string())?;
    runtime_log::record_event("info", "logs.opened", "User opened the log directory");
    app.opener()
        .open_path(dir.display().to_string(), None::<String>)
        .map_err(|err| err.to_string())
}

/// Reveal a file in the platform file manager instead of opening it with its
/// default application. This deliberately lives outside the opener plugin:
/// macOS and Windows expose selection through platform-specific commands.
#[tauri::command]
pub fn reveal_in_file_manager(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg("-R").arg(path).status()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .status()
    } else {
        let directory = if path.is_dir() {
            path
        } else {
            path.parent()
                .ok_or_else(|| format!("Path has no parent directory: {}", path.display()))?
        };
        Command::new("xdg-open").arg(directory).status()
    }
    .map_err(|err| format!("Failed to launch file manager: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("File manager exited with status {status}"))
    }
}
