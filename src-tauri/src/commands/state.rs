use crate::download::Manager as DownloadManager;
use crate::error::AppError;
use crate::launcher::LauncherManager;
use crate::mover::MoveManager;
use crate::sidecar::{self, SidecarClient};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

pub use crate::sidecar::{ActivityItem, ProfileDto};

pub struct AppState {
    pub sidecar: AsyncMutex<Option<Arc<SidecarClient>>>,
    pub session_dir: PathBuf,
    pub sidecar_path: PathBuf,
    pub downloads_dir: PathBuf,
    pub downloader: Arc<DownloadManager>,
    pub launcher: Arc<LauncherManager>,
    pub mover: Arc<MoveManager>,
    pub achievements: Arc<crate::achievements::Watcher>,
    pub overlay_context: Mutex<Option<super::overlay::OverlayContext>>,
    pub overlay_visible: Mutex<bool>,
    pub overlay_target_pid: Mutex<Option<u32>>,
    pub overlay_follow_cancel: Mutex<Option<oneshot::Sender<()>>>,
    pub overlay_hint_follow_cancel: Mutex<Option<oneshot::Sender<()>>>,
    pub overlay_hint_hide_cancel: Mutex<Option<oneshot::Sender<()>>>,
    pub overlay_hint_reveal_cancel: Mutex<Option<oneshot::Sender<()>>>,
    pub overlay_hint_generation: Mutex<u64>,
    pub overlay_hint_showing_pid: Mutex<Option<u32>>,
    pub overlay_hint_payload: Mutex<Option<super::overlay::OverlayHintPayload>>,
    pub overlay_cached_layout: Mutex<super::overlay::OverlayLayout>,
    /// Mirrors experimental "overlay enabled" from the frontend (updated via overlay_sync_hotkey).
    pub overlay_user_enabled: Mutex<bool>,
    /// Effective global shortcut registered for overlay toggle (may differ from user setting).
    pub overlay_registered_hotkey: Mutex<String>,
    /// While `Instant::now() < until`, the overlay follow loop skips repositioning.
    pub overlay_follow_paused_until: Mutex<Option<std::time::Instant>>,
}

pub(crate) async fn ensure_sidecar(state: &AppState) -> Result<Arc<SidecarClient>, AppError> {
    sidecar::ensure(
        &state.sidecar,
        &state.session_dir,
        state.sidecar_path.clone(),
    )
    .await
}

pub fn build_state(app: &AppHandle) -> Result<AppState, AppError> {
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("app_local_data_dir: {e}")))?;
    std::fs::create_dir_all(&local)?;
    let session_dir = local.join("sessions");
    std::fs::create_dir_all(&session_dir)?;
    let downloads_dir = local.join("downloads");
    std::fs::create_dir_all(&downloads_dir)?;

    let sidecar_path = sidecar::resolve_sidecar_path()?;
    let downloader = Arc::new(DownloadManager::new(downloads_dir.clone()));
    let launcher = Arc::new(LauncherManager::new());
    let mover = Arc::new(MoveManager::new());
    let achievements = Arc::new(crate::achievements::Watcher::new());
    Ok(AppState {
        sidecar: AsyncMutex::new(None),
        session_dir,
        sidecar_path,
        downloads_dir,
        downloader,
        launcher,
        mover,
        achievements,
        overlay_context: Mutex::new(None),
        overlay_visible: Mutex::new(false),
        overlay_target_pid: Mutex::new(None),
        overlay_follow_cancel: Mutex::new(None),
        overlay_hint_follow_cancel: Mutex::new(None),
        overlay_hint_hide_cancel: Mutex::new(None),
        overlay_hint_reveal_cancel: Mutex::new(None),
        overlay_hint_generation: Mutex::new(0),
        overlay_hint_showing_pid: Mutex::new(None),
        overlay_hint_payload: Mutex::new(None),
        overlay_cached_layout: Mutex::new(super::overlay::default_overlay_layout()),
        overlay_user_enabled: Mutex::new(false),
        overlay_registered_hotkey: Mutex::new(String::new()),
        overlay_follow_paused_until: Mutex::new(None),
    })
}
