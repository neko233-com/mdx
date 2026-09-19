//! Native document exporters.
//!
//! The web layer owns the printable DOM. This module only asks the platform
//! WebView to turn that DOM into PDF bytes, then commits the result through the
//! existing export authorization and atomic-write path.

use std::fs::{self, File};
use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow};

use crate::app::state::AppState;
use crate::lock_utils::read_lock;

fn temporary_pdf_path(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "PDF target has no parent directory".to_string())?;
    let temporary = tempfile::Builder::new()
        .prefix(".flowix-pdf-")
        .suffix(".pdf")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    let path = temporary.path().to_path_buf();
    drop(temporary);
    Ok(path)
}

#[tauri::command]
pub async fn export_pdf(
    window: WebviewWindow,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let requested = Path::new(&file_path);
    let target = state
        .export_access
        .authorized_target(window.label(), requested)
        .map_err(|error| error.to_string())?;
    let temporary = temporary_pdf_path(&target)?;

    let native_result = export_pdf_native(window.clone(), temporary.clone()).await;
    let result = match native_result {
        Ok(()) => {
            let mut reader = File::open(&temporary).map_err(|error| error.to_string())?;
            state
                .export_access
                .save(
                    window.label(),
                    &target,
                    &mut reader,
                    &read_lock(&state.memo_file, "memo_file"),
                )
                .map(|()| true)
                .map_err(|error| error.to_string())
        }
        Err(error) => Err(error),
    };

    let _ = fs::remove_file(&temporary);
    result
}

#[cfg(target_os = "macos")]
async fn export_pdf_native(window: WebviewWindow, output: PathBuf) -> Result<(), String> {
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::{Arc, Mutex};

    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView};
    use tokio::sync::oneshot;

    let (sender, receiver) = oneshot::channel::<Result<Vec<u8>, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));

    window
        .with_webview(move |webview| {
            let sender = Arc::clone(&sender);
            let raw = webview.inner();
            let Some(marker) = MainThreadMarker::new() else {
                if let Ok(mut sender) = sender.lock() {
                    let _ = sender.take().map(|sender| {
                        sender.send(Err("PDF export must run on the main thread".to_string()))
                    });
                }
                return;
            };

            let Some(webview) = (unsafe { (raw as *const WKWebView).as_ref() }) else {
                if let Ok(mut sender) = sender.lock() {
                    let _ = sender
                        .take()
                        .map(|sender| sender.send(Err("WKWebView is unavailable".to_string())));
                }
                return;
            };

            let configuration = unsafe { WKPDFConfiguration::new(marker) };
            let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err("WKWebView failed to create PDF".to_string())
                } else if data.is_null() {
                    Err("WKWebView returned empty PDF data".to_string())
                } else {
                    let data = unsafe { &*data };
                    let length = data.length() as usize;
                    let mut bytes = vec![0_u8; length];
                    if length > 0 {
                        unsafe {
                            data.getBytes_length(
                                NonNull::new(bytes.as_mut_ptr().cast::<c_void>())
                                    .expect("non-empty PDF buffer"),
                                length,
                            );
                        }
                    }
                    Ok(bytes)
                };

                if let Ok(mut sender) = sender.lock() {
                    let _ = sender.take().map(|sender| sender.send(result));
                }
            });

            unsafe {
                webview.createPDFWithConfiguration_completionHandler(
                    Some(&configuration),
                    &completion,
                );
            }
        })
        .map_err(|error| error.to_string())?;

    let bytes = receiver
        .await
        .map_err(|_| "WKWebView PDF callback was cancelled".to_string())??;
    tokio::task::spawn_blocking(move || fs::write(output, bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
async fn export_pdf_native(window: WebviewWindow, output: PathBuf) -> Result<(), String> {
    use std::sync::mpsc;

    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintToPdfCompletedHandler};
    use windows::core::{Interface, PCWSTR};

    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    let output = output
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect::<Vec<_>>();

    window
        .with_webview(move |webview| {
            let controller = webview.controller();
            let environment = webview.environment();
            let result = (|| -> windows::core::Result<()> {
                let core = unsafe { controller.CoreWebView2()? };
                let printable = core.cast::<ICoreWebView2_7>()?;
                let environment = environment.cast::<ICoreWebView2Environment6>()?;
                let settings = unsafe { environment.CreatePrintSettings()? };
                // PDF output is a document representation, not a screenshot of
                // the themed app surface. Keep page/background painting off;
                // the print stylesheet also deliberately uses transparent
                // backgrounds.
                unsafe { settings.SetShouldPrintBackgrounds(false)? };
                let output = PCWSTR(output.as_ptr());
                let callback_sender = sender.clone();
                let callback =
                    PrintToPdfCompletedHandler::create(Box::new(move |status, success| {
                        let result = match status {
                            Ok(()) if success => Ok(()),
                            Ok(()) => Err("WebView2 did not create the PDF".to_string()),
                            Err(error) => Err(error.to_string()),
                        };
                        let _ = callback_sender.send(result);
                        Ok(())
                    }));
                unsafe { printable.PrintToPdf(output, &settings, &callback)? };
                Ok(())
            })();

            if let Err(error) = result {
                let _ = sender.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|_| "WebView2 PDF callback was cancelled".to_string())?
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn export_pdf_native(_window: WebviewWindow, _output: PathBuf) -> Result<(), String> {
    Err("Native PDF export is not supported on this platform yet".to_string())
}
