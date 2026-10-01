use super::state::AppState;
use crate::download::host::clean_download_filename;
use crate::error::AppError;
use fs4::available_space;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Serialize)]
pub struct ExtractResult {
    #[serde(rename = "destDir")]
    pub dest_dir: String,
    #[serde(rename = "exePath")]
    pub exe_path: Option<String>,
    /// Engine detectada por marcadores no diretório (slug de `engine_detect`).
    pub engine: Option<String>,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
}

/// Extract a downloaded archive next to itself (folder named after the file
/// stem) and pick the most likely game executable inside. The CPU work runs
/// on a blocking thread so it doesn't block the Tokio runtime. Progress lands
/// no evento `extract:progress` (percentual por arquivo) e o fim — sucesso ou
/// erro — em `extract:done`, para a UI limpar o estado.
#[tauri::command]
pub async fn extract_archive(
    app: AppHandle,
    archive_path: String,
    game_title: String,
) -> Result<ExtractResult, AppError> {
    let event_path = archive_path.clone();
    let app_events = app.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<ExtractResult, AppError> {
        let archive = PathBuf::from(&archive_path);
        if !archive.exists() {
            return Err(AppError::Other(format!(
                "arquivo não encontrado: {}",
                archive.display()
            )));
        }
        let parent = archive
            .parent()
            .ok_or_else(|| AppError::Other("archive has no parent directory".into()))?;
        let stem = archive
            .file_name()
            .and_then(|s| s.to_str())
            .map(clean_download_filename)
            .and_then(|name| {
                std::path::Path::new(&name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "extracted".to_string());
        let dest = parent.join(stem);
        let mut last_pct = u8::MAX;
        let mut on_progress = |pct: u8| {
            if pct == last_pct {
                return;
            }
            last_pct = pct;
            let _ = app_events.emit(
                "extract:progress",
                serde_json::json!({ "archivePath": archive_path, "percent": pct }),
            );
        };
        crate::extraction::extract(&archive, &dest, &mut on_progress)?;
        let exe = crate::extraction::find_main_exe(&dest, &game_title);
        Ok(ExtractResult {
            engine: crate::engine_detect::detect_engine(&dest).map(str::to_string),
            size_bytes: dir_size_of(&dest),
            dest_dir: dest.to_string_lossy().into_owned(),
            exe_path: exe.map(|p| p.to_string_lossy().into_owned()),
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("extract task join: {e}")))?;
    let _ = app.emit(
        "extract:done",
        serde_json::json!({ "archivePath": event_path }),
    );
    result
}

/// Soma rasa do tamanho em disco de um diretório (bytes lógicos dos arquivos).
fn dir_size_of(root: &std::path::Path) -> u64 {
    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(root).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

#[derive(Debug, Serialize)]
pub struct InstallDirProbe {
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    pub engine: Option<String>,
    pub exists: bool,
}

/// Tamanho + engine de um diretório de instalação. Usado para semear em
/// `install_versions` as instalações feitas antes do versionamento existir
/// (que não passaram pelo extract_archive novo).
#[tauri::command]
pub async fn probe_install_dir(path: String) -> Result<InstallDirProbe, AppError> {
    tokio::task::spawn_blocking(move || {
        let dir = PathBuf::from(&path);
        if !dir.is_dir() {
            return Ok(InstallDirProbe {
                size_bytes: 0,
                engine: None,
                exists: false,
            });
        }
        Ok(InstallDirProbe {
            size_bytes: dir_size_of(&dir),
            engine: crate::engine_detect::detect_engine(&dir).map(str::to_string),
            exists: true,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("probe task join: {e}")))?
}

/// Downscaled cached image for sidebar (thumb) or reader (display). GIF display uses the original file.
#[tauri::command]
pub async fn resolve_media_preview(
    app: AppHandle,
    path: String,
    variant: String,
) -> Result<String, AppError> {
    let source = PathBuf::from(&path);
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("media_preview");
    tokio::task::spawn_blocking(move || {
        crate::media_preview::resolve_preview(&source, &variant, &cache_root)
    })
    .await
    .map_err(|e| AppError::Other(format!("preview task join: {e}")))?
}

/// Cached ~720px JPEG from a remote URL (screenshot grids).
#[tauri::command]
pub async fn resolve_remote_image_preview(
    app: AppHandle,
    url: String,
    variant: String,
) -> Result<String, AppError> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("remote_image_preview");
    crate::remote_image_preview::resolve(&url, &variant, &cache_root).await
}

#[tauri::command]
pub async fn scan_install_media(
    install_path: String,
    category: String,
) -> Result<crate::media_scan::InstallMediaIndex, AppError> {
    let path = PathBuf::from(&install_path);
    tokio::task::spawn_blocking(move || crate::media_scan::scan_install(&path, &category))
        .await
        .map_err(|e| AppError::Other(format!("scan task join: {e}")))?
}

#[derive(Debug, Serialize)]
pub struct CbzPreviewResult {
    #[serde(rename = "tempDir")]
    pub temp_dir: String,
    pub pages: Vec<String>,
}

/// Extract up to `max_pages` images from a CBZ/CBR into a temp directory for in-app viewing.
#[tauri::command]
pub async fn extract_cbz_preview(
    archive_path: String,
    max_pages: Option<usize>,
) -> Result<CbzPreviewResult, AppError> {
    let max = max_pages.unwrap_or(200).min(500);
    let archive = PathBuf::from(&archive_path);
    tokio::task::spawn_blocking(move || -> Result<CbzPreviewResult, AppError> {
        let temp = std::env::temp_dir().join(format!(
            "f95app_cbz_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
        let pages = crate::media_scan::extract_cbz_images(&archive, &temp, max)?;
        Ok(CbzPreviewResult {
            temp_dir: temp.to_string_lossy().into_owned(),
            pages,
        })
    })
    .await
    .map_err(|e| AppError::Other(format!("cbz task join: {e}")))?
}

/// Copy save folders from `old_install_dir` to `new_install_dir` before the
/// old directory is deleted on update. Returns counts for UI feedback (caller
/// can show "carregou 2 saves (1.4 MB)" or stay silent if `copied == 0`).
#[tauri::command]
pub async fn migrate_saves(
    old_install_dir: String,
    new_install_dir: String,
) -> Result<crate::save_migration::MigrationResult, AppError> {
    let old = PathBuf::from(old_install_dir);
    let new = PathBuf::from(new_install_dir);
    tokio::task::spawn_blocking(move || crate::save_migration::migrate(&old, &new))
        .await
        .map_err(|e| AppError::Other(format!("migrate_saves join: {e}")))?
}

/// Recursively delete an install directory. Refuses targets outside any of
/// the `safe_roots` so the user can never accidentally point us at, say,
/// `C:\Windows` by editing the DB.
///
/// `safe_roots` typically comes from the frontend's `install_libraries`
/// table - every registered library is a legitimate place for an install.
/// Falls back to the legacy default downloads dir when no roots are given.
///
/// Returns `true` if the delete happened (or the path was already gone),
/// `false` if the target was outside every safe root.
#[tauri::command]
pub async fn delete_install_dir(
    state: State<'_, AppState>,
    path: String,
    safe_roots: Option<Vec<String>>,
) -> Result<bool, AppError> {
    let target = PathBuf::from(path);
    let mut roots: Vec<PathBuf> = safe_roots
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .collect();
    if roots.is_empty() {
        roots.push(state.downloads_dir.clone());
    }
    tokio::task::spawn_blocking(move || crate::save_migration::delete_under(&target, &roots))
        .await
        .map_err(|e| AppError::Other(format!("delete_install_dir join: {e}")))?
}

/// Delete a single file (e.g. archive after extraction). Directories are rejected.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), AppError> {
    let target = PathBuf::from(path);
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        if !target.exists() {
            return Ok(());
        }
        if target.is_dir() {
            return Err(AppError::Other(
                "delete_path só aceita arquivos, não pastas".into(),
            ));
        }
        std::fs::remove_file(&target).map_err(|e| AppError::Io(e.to_string()))
    })
    .await
    .map_err(|e| AppError::Other(format!("delete_path join: {e}")))??;
    Ok(())
}

/// Return the legacy default downloads path. Frontend seeds this as the
/// first row in `install_libraries` on first launch so existing rows in
/// `downloads`/`library_games` keep working.
#[tauri::command]
pub fn default_downloads_path(state: State<'_, AppState>) -> Result<String, AppError> {
    Ok(state.downloads_dir.to_string_lossy().into_owned())
}

#[derive(Debug, Serialize)]
pub struct DiskInfo {
    #[serde(rename = "freeBytes")]
    pub free_bytes: u64,
    /// True when the path exists and we could read its disk info. Frontend
    /// uses this to grey out libraries that point at an unplugged drive.
    pub available: bool,
}

/// Free-space on the filesystem that hosts `path`. Used by the install-
/// library picker UI to show "D:\F95 (livre: 203 GB)".
///
/// Returns `available: false` (with `free_bytes: 0`) when the path doesn't
/// exist or fs4 can't read it - typical for an unmounted external drive.
#[tauri::command]
pub fn disk_info(path: String) -> Result<DiskInfo, AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(DiskInfo {
            free_bytes: 0,
            available: false,
        });
    }
    match available_space(&p) {
        Ok(free) => Ok(DiskInfo {
            free_bytes: free,
            available: true,
        }),
        Err(_) => Ok(DiskInfo {
            free_bytes: 0,
            available: false,
        }),
    }
}

/// Reveal a file in the OS file manager. On Windows this delegates to
/// `explorer.exe`. We do this ourselves instead of going through
/// `tauri-plugin-opener::revealItemInDir` because that path goes through
/// `SHOpenFolderAndSelectItems`, which has been observed to fail silently in
/// some Windows configurations and pop a misleading "location not available"
/// dialog from Explorer.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        // Fall back to the parent if the target was deleted between download
        // and the user clicking the button.
        if let Some(parent) = p.parent() {
            if parent.exists() {
                return spawn_explorer_open(parent);
            }
        }
        return Err(AppError::Other(format!(
            "path does not exist: {}",
            p.display()
        )));
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_file() {
            spawn_explorer_select(p)
        } else {
            spawn_explorer_open(p)
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        spawn_explorer_open(p)
    }
}

#[cfg(target_os = "windows")]
fn spawn_explorer_select(path: &std::path::Path) -> Result<(), AppError> {
    // /select must be passed as a SINGLE argument with the path concatenated
    // (`/select,C:\foo\bar.txt`) - splitting it into two args causes explorer
    // to ignore the path entirely. std::process::Command on Windows quotes
    // args that contain spaces, but not those with backslashes, so the
    // formatted argument lands on explorer.exe's CLI exactly as intended.
    let arg = format!("/select,{}", path.display());
    std::process::Command::new("explorer.exe")
        .arg(&arg)
        .spawn()
        .map_err(|e| AppError::Other(format!("explorer.exe failed: {e}")))?;
    Ok(())
}

fn spawn_explorer_open(path: &std::path::Path) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| AppError::Other(format!("explorer.exe failed: {e}")))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| AppError::Other(format!("open failed: {e}")))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| AppError::Other(format!("xdg-open failed: {e}")))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err(AppError::Other("unsupported platform".into()))
}
