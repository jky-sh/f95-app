use super::state::AppState;

use crate::error::AppError;

use crate::overlay_anchor::{self, start_follow, stop_follow};

use serde::{Deserialize, Serialize};

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

static OVERLAY_BUILD_LOCK: Mutex<()> = Mutex::new(());

fn overlay_log(app: Option<&AppHandle>, message: impl AsRef<str>) {
    let line = format!("[overlay] {}", message.as_ref());
    eprintln!("{line}");
    if let Some(app) = app {
        crate::dev_debug::log(Some(app), "overlay", message.as_ref());
    }
}

fn user_overlay_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("não pôde ser inicializada") || lower.contains("não encontrada") {
        "Não foi possível abrir a janela do overlay. Feche e abra o F95 App novamente.".into()
    } else if lower.contains("minimizado") {
        "O jogo está minimizado — restaure a janela do jogo.".into()
    } else if lower.contains("janelas ativas") {
        "A janela do overlay não iniciou corretamente. Feche e abra o F95 App novamente.".into()
    } else {
        raw.to_string()
    }
}

pub const OVERLAY_WINDOW_LABEL: &str = "game-overlay";

pub const OVERLAY_HINT_WINDOW_LABEL: &str = "overlay-hint";



#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct OverlayContext {

    #[serde(rename = "threadId")]

    pub thread_id: String,

    pub title: String,

    #[serde(rename = "thumbnailUrl")]

    pub thumbnail_url: Option<String>,

    #[serde(rename = "sessionId")]

    pub session_id: i64,

}



#[derive(Debug, Clone, Deserialize, Serialize)]

pub struct OverlayCompactGeom {

    pub x: f64,

    pub y: f64,

    pub w: f64,

    pub h: f64,

}



#[derive(Debug, Clone, Deserialize, Serialize)]

pub struct OverlayLayout {

    #[serde(rename = "displayMode")]

    pub display_mode: String,

    pub geom: Option<OverlayCompactGeom>,

}



#[derive(Debug, Clone, Serialize)]

pub struct OverlayAnchorStatus {

    pub attached: bool,

    pub pid: Option<u32>,

    #[serde(rename = "gameRect")]

    pub game_rect: Option<crate::game_window::ScreenRect>,

    #[serde(rename = "attachMode")]
    pub attach_mode: Option<String>,

    pub message: Option<String>,

}



/// Resolve a pre-created webview from `tauri.conf.json` (never build at runtime).
fn webview_by_label(app: &AppHandle, label: &str) -> Option<tauri::WebviewWindow> {
    if let Some(win) = app.get_webview_window(label) {
        return Some(win);
    }
    if let Some(win) = app.webview_windows().get(label) {
        return Some(win.clone());
    }
    app.webview_windows()
        .values()
        .find(|w| w.label() == label)
        .cloned()
}

fn build_error_is_duplicate(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("already exists") || lower.contains("already a window")
}

fn destroy_stale_window_label(app: &AppHandle, label: &str) {
    if webview_by_label(app, label).is_some() {
        return;
    }
    overlay_log(Some(app), format!("removendo shell fantasma: {label}"));
    for win in app.windows().values() {
        if win.label() == label {
            let _ = win.close();
            std::thread::sleep(Duration::from_millis(200));
            return;
        }
    }
}

fn create_overlay_window_fallback(app: &AppHandle, label: &str) -> Result<(), AppError> {
    let (url, title, w, h) = match label {
        OVERLAY_WINDOW_LABEL => (
            "index.html?window=overlay",
            "F95 App Overlay",
            960.0,
            640.0,
        ),
        OVERLAY_HINT_WINDOW_LABEL => (
            "index.html?window=overlay-hint",
            "F95 Overlay Hint",
            400.0,
            96.0,
        ),
        other => return Err(AppError::Other(format!("label overlay desconhecido: {other}"))),
    };

    overlay_log(
        Some(app),
        format!("WebviewWindowBuilder::new label={label} url={url}"),
    );

    match WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(w, h)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()
    {
        Ok(_) => {
            overlay_log(Some(app), format!("build OK: {label}"));
            Ok(())
        }
        Err(e) => {
            let err = e.to_string();
            overlay_log(Some(app), format!("build falhou {label}: {err}"));
            if build_error_is_duplicate(&err) {
                Ok(())
            } else {
                Err(AppError::Other(format!("criar janela {label}: {e}")))
            }
        }
    }
}

fn ensure_overlay_window_built(app: &AppHandle, label: &str) -> Result<(), AppError> {
    if let Some(_) = webview_by_label(app, label) {
        overlay_log(Some(app), format!("janela {label} já disponível"));
        return Ok(());
    }

    let _lock = OVERLAY_BUILD_LOCK
        .lock()
        .map_err(|e| AppError::Other(format!("overlay build lock: {e}")))?;

    if webview_by_label(app, label).is_some() {
        return Ok(());
    }

    destroy_stale_window_label(app, label);
    create_overlay_window_fallback(app, label)?;

    if webview_by_label(app, label).is_none() {
        overlay_log(
            Some(app),
            format!("primeira criação de {label} sem webview — tentando de novo"),
        );
        destroy_stale_window_label(app, label);
        create_overlay_window_fallback(app, label)?;
    }

    let max_polls = if label == OVERLAY_WINDOW_LABEL { 120 } else { 40 };
    for attempt in 0..max_polls {
        if webview_by_label(app, label).is_some() {
            overlay_log(
                Some(app),
                format!("janela {label} registrada após {attempt} polls"),
            );
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let known: Vec<String> = app
        .webview_windows()
        .values()
        .map(|w| w.label().to_string())
        .collect();
    let shell_labels: Vec<String> = app
        .windows()
        .values()
        .map(|w| w.label().to_string())
        .collect();
    overlay_log(
        Some(app),
        format!(
            "falha ao registrar {label}: webviews={known:?} shells={shell_labels:?}"
        ),
    );
    Err(AppError::Other(format!(
        "janela {label} não pôde ser inicializada (janelas ativas: {known:?})"
    )))
}

/// Cria as janelas `game-overlay` e `overlay-hint` na inicialização do app.
pub fn init_overlay_windows(app: &AppHandle) -> Result<(), AppError> {
    overlay_log(Some(app), "init_overlay_windows: início");
    ensure_overlay_window_built(app, OVERLAY_WINDOW_LABEL)?;
    ensure_overlay_window_built(app, OVERLAY_HINT_WINDOW_LABEL)?;
    overlay_log(Some(app), "init_overlay_windows: concluído");
    Ok(())
}

fn ensure_overlay_window(app: &AppHandle) -> Result<tauri::WebviewWindow, AppError> {
    if let Some(win) = webview_by_label(app, OVERLAY_WINDOW_LABEL) {
        return Ok(win);
    }
    ensure_overlay_window_built(app, OVERLAY_WINDOW_LABEL)?;
    webview_by_label(app, OVERLAY_WINDOW_LABEL).ok_or_else(|| {
        AppError::Other(format!(
            "janela {OVERLAY_WINDOW_LABEL} não encontrada — reinicie o F95 App"
        ))
    })
}

fn ensure_hint_window(app: &AppHandle) -> Result<tauri::WebviewWindow, AppError> {
    if let Some(win) = webview_by_label(app, OVERLAY_HINT_WINDOW_LABEL) {
        return Ok(win);
    }
    ensure_overlay_window_built(app, OVERLAY_HINT_WINDOW_LABEL)?;
    webview_by_label(app, OVERLAY_HINT_WINDOW_LABEL).ok_or_else(|| {
        AppError::Other(format!(
            "janela {OVERLAY_HINT_WINDOW_LABEL} não encontrada — reinicie o F95 App"
        ))
    })
}

fn hint_title_for_thread(state: &AppState, thread_id: &str) -> Option<String> {
    state.overlay_context.lock().ok().and_then(|g| {
        g.as_ref().and_then(|ctx| {
            if ctx.thread_id == thread_id && !ctx.title.trim().is_empty() {
                Some(ctx.title.clone())
            } else {
                None
            }
        })
    })
}

pub fn overlay_effective_visible(app: &AppHandle, state: &AppState) -> bool {
    let actual = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if let Ok(mut cached) = state.overlay_visible.lock() {
        if *cached != actual {
            *cached = actual;
        }
        actual
    } else {
        actual
    }
}

fn normalize_game_pid(pid: u32) -> u32 {
    #[cfg(windows)]
    {
        crate::game_window::resolve_visible_game_pid(pid)
    }
    #[cfg(not(windows))]
    {
        pid
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayHintPayload {
    pub title: String,
    pub hotkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayErrorPayload {
    pub message: String,
}

fn stop_hint_follow(app: &AppHandle) {
    let cancel = app.try_state::<AppState>().and_then(|state| {
        state
            .overlay_hint_follow_cancel
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    });
    if let Some(tx) = cancel {
        let _ = tx.send(());
    }
}

fn stop_hint_hide_timer(app: &AppHandle) {
    let cancel = app.try_state::<AppState>().and_then(|state| {
        state
            .overlay_hint_hide_cancel
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    });
    if let Some(tx) = cancel {
        let _ = tx.send(());
    }
}

fn stop_hint_reveal(app: &AppHandle) {
    let cancel = app.try_state::<AppState>().and_then(|state| {
        state
            .overlay_hint_reveal_cancel
            .lock()
            .ok()
            .and_then(|mut g| g.take())
    });
    if let Some(tx) = cancel {
        let _ = tx.send(());
    }
}

fn bump_hint_generation(state: &AppState) -> u64 {
    state
        .overlay_hint_generation
        .lock()
        .map(|mut g| {
            *g = g.saturating_add(1);
            *g
        })
        .unwrap_or(0)
}

fn hint_generation_matches(state: &AppState, generation: u64) -> bool {
    state
        .overlay_hint_generation
        .lock()
        .map(|g| *g == generation)
        .unwrap_or(false)
}

fn clear_hint_showing_pid(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.overlay_hint_showing_pid.lock() {
            *g = None;
        }
    }
}

fn hide_game_hint(app: &AppHandle) {
    stop_hint_follow(app);
    stop_hint_hide_timer(app);
    stop_hint_reveal(app);
    if let Some(state) = app.try_state::<AppState>() {
        bump_hint_generation(&state);
    }
    clear_hint_showing_pid(app);
    if let Some(win) = app.get_webview_window(OVERLAY_HINT_WINDOW_LABEL) {
        #[cfg(windows)]
        if let Ok(hwnd) = win.hwnd() {
            crate::game_window::win32_hide(hwnd);
        }
        let _ = win.hide();
    }
}

#[cfg(windows)]
fn emit_hint_payload(window: &tauri::WebviewWindow, payload: &OverlayHintPayload) {
    let _ = window.emit("overlay:hint", payload);
}

#[cfg(windows)]
fn emit_error_payload(window: &tauri::WebviewWindow, payload: &OverlayErrorPayload) {
    let _ = window.emit("overlay:error", payload);
}

#[cfg(windows)]
fn schedule_error_auto_hide(app: AppHandle) {
    stop_hint_hide_timer(&app);
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.overlay_hint_hide_cancel.lock() {
            *g = Some(tx);
        }
    }
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = &mut rx => {}
            _ = tokio::time::sleep(Duration::from_secs(7)) => {
                if let Some(win) = app.get_webview_window(OVERLAY_HINT_WINDOW_LABEL) {
                    #[cfg(windows)]
                    if let Ok(hwnd) = win.hwnd() {
                        crate::game_window::win32_hide(hwnd);
                    }
                    let _ = win.hide();
                }
            }
        }
    });
}

#[cfg(windows)]
async fn reveal_error_on_game(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    pid: u32,
    message: &str,
) -> Result<(), AppError> {
    let friendly = user_overlay_error(message);
    let payload = OverlayErrorPayload {
        message: friendly.clone(),
    };
    let game_match = crate::game_window::find_game_window_with_hwnd(pid)
        .or_else(|| crate::game_window::find_game_window_for_overlay(pid));
    let Some(game_match) = game_match else {
        overlay_log(
            Some(app),
            format!("erro overlay sem janela de jogo (pid={pid}): {friendly}"),
        );
        return Ok(());
    };

    place_hint_on_game(window, &game_match, true)?;
    window
        .show()
        .map_err(|e| AppError::Other(format!("overlay-error show: {e}")))?;
    let _ = place_hint_on_game(window, &game_match, false);
    if let Ok(hwnd) = window.hwnd() {
        crate::game_window::win32_show_no_activate(hwnd);
        crate::game_window::raise_overlay(hwnd);
    }

    tokio::time::sleep(Duration::from_millis(120)).await;
    for _ in 0..3 {
        emit_error_payload(window, &payload);
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
    schedule_error_auto_hide(app.clone());
    Ok(())
}

pub async fn report_overlay_failure(app: &AppHandle, state: &AppState, raw_message: String) {
    let friendly = user_overlay_error(&raw_message);
    overlay_log(Some(app), format!("falha: {friendly} (raw: {raw_message})"));
    #[cfg(windows)]
    {
        if let Ok(win) = ensure_hint_window(app) {
            if let Ok(pid) = resolve_overlay_pid(state).await {
                let _ = reveal_error_on_game(app, &win, pid, &raw_message).await;
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (state, friendly);
    }
}

#[cfg(windows)]
fn schedule_hint_auto_hide(app: AppHandle) {
    stop_hint_hide_timer(&app);
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.overlay_hint_hide_cancel.lock() {
            *g = Some(tx);
        }
    }
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = &mut rx => {}
            _ = tokio::time::sleep(Duration::from_secs(8)) => {
                hide_game_hint(&app);
            }
        }
    });
}

#[cfg(windows)]
async fn reveal_hint_on_game(
    app: &AppHandle,
    state: &AppState,
    window: &tauri::WebviewWindow,
    pid: u32,
    game_match: &crate::game_window::GameWindowMatch,
    payload: &OverlayHintPayload,
) -> Result<(), AppError> {
    // Position with Win32 first — Tauri show() resets screen coords and breaks anchoring.
    place_hint_on_game(window, game_match, true)?;
    window
        .show()
        .map_err(|e| AppError::Other(format!("overlay-hint show: {e}")))?;
    let _ = place_hint_on_game(window, game_match, false);
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        crate::game_window::win32_show_no_activate(hwnd);
        crate::game_window::raise_overlay(hwnd);
    }

    tokio::time::sleep(Duration::from_millis(120)).await;
    for _ in 0..3 {
        emit_hint_payload(window, payload);
        tokio::time::sleep(Duration::from_millis(60)).await;
    }

    if let Ok(mut guard) = state.overlay_hint_showing_pid.lock() {
        *guard = Some(pid);
    }

    start_hint_follow(app.clone(), pid);
    schedule_hint_auto_hide(app.clone());
    Ok(())
}

#[cfg(windows)]
fn place_hint_on_game(
    window: &tauri::WebviewWindow,
    game_match: &crate::game_window::GameWindowMatch,
    show: bool,
) -> Result<(), AppError> {
    if let Some(hwnd) = game_match.hwnd.map(|h| windows::Win32::Foundation::HWND(h as _)) {
        if crate::game_window::is_minimized(hwnd) {
            return Err(AppError::Other("O jogo está minimizado.".into()));
        }
    }
    let overlay_hwnd = window
        .hwnd()
        .map_err(|e| AppError::Other(format!("overlay-hint hwnd: {e}")))?;
    crate::game_window::place_hint(overlay_hwnd, game_match, show).map_err(AppError::Other)?;
    Ok(())
}

#[cfg(windows)]
fn start_hint_follow(app: AppHandle, pid: u32) {
    stop_hint_follow(&app);
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut g) = state.overlay_hint_follow_cancel.lock() {
            *g = Some(tx);
        }
    }

    tauri::async_runtime::spawn(async move {
        // ~240 Hz + adaptive lerp: silky when close, snappy when the game window jumps.
        const TICK_MS: u64 = 4;
        const SMOOTH_NEAR: f32 = 0.38;
        const SMOOTH_MID: f32 = 0.62;
        const SMOOTH_FAR: f32 = 0.82;

        let mut display_rect: Option<crate::game_window::ScreenRect> = None;
        let mut last_surface_hwnd: Option<isize> = None;
        let tick = Duration::from_millis(TICK_MS);
        let max = Duration::from_secs(6);
        let mut elapsed = Duration::ZERO;

        while elapsed < max {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(tick) => {
                    elapsed += tick;
                    let Some(win) = app.get_webview_window(OVERLAY_HINT_WINDOW_LABEL) else {
                        break;
                    };
                    if !win.is_visible().unwrap_or(false) {
                        break;
                    }
                    let Ok(overlay_hwnd) = win.hwnd() else {
                        continue;
                    };
                    let game_match = crate::game_window::find_game_window_with_hwnd(pid)
                        .or_else(|| crate::game_window::find_game_window_for_overlay(pid));
                    let Some(game_match) = game_match else {
                        continue;
                    };
                    if let Some(hwnd) = game_match.hwnd.map(|h| windows::Win32::Foundation::HWND(h as _)) {
                        if crate::game_window::is_minimized(hwnd) {
                            continue;
                        }
                    }

                    let surface_key = game_match.hwnd.unwrap_or(0);
                    if last_surface_hwnd != Some(surface_key) {
                        display_rect = None;
                        last_surface_hwnd = Some(surface_key);
                    }

                    let target = crate::game_window::hint_rect_on_game(game_match.rect);
                    let current = display_rect.unwrap_or(target);
                    let next = if crate::game_window::hint_rects_close(current, target) {
                        target
                    } else {
                        let dx = target.x - current.x;
                        let dy = target.y - current.y;
                        let dist_sq = dx * dx + dy * dy;
                        let factor = if dist_sq > 180 * 180 {
                            SMOOTH_FAR
                        } else if dist_sq > 48 * 48 {
                            SMOOTH_MID
                        } else {
                            SMOOTH_NEAR
                        };
                        crate::game_window::smooth_hint_rect_toward(current, target, factor)
                    };

                    if display_rect != Some(next) {
                        let _ = crate::game_window::place_hint_at_rect(
                            overlay_hwnd,
                            next,
                            false,
                        );
                        display_rect = Some(next);
                    }
                }
            }
        }
    });
}

#[cfg(windows)]
async fn reveal_hint_when_ready(app: &AppHandle, pid: u32, generation: u64) {
    const MAX_POLLS: u32 = 60;
    const POLL_MS: u64 = 300;

    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    if let Ok(mut g) = state.overlay_hint_reveal_cancel.lock() {
        *g = Some(tx);
    }

    for attempt in 0..MAX_POLLS {
        if !hint_generation_matches(&state, generation) {
            return;
        }
        tokio::select! {
            _ = &mut rx => return,
            _ = tokio::time::sleep(Duration::from_millis(if attempt == 0 { 0 } else { POLL_MS })) => {}
        }
        if !hint_generation_matches(&state, generation) {
            return;
        }

        if let Some(game_match) = crate::game_window::find_game_window_with_hwnd(pid) {
            if try_reveal_cached_hint(app, pid, &game_match, generation).await {
                return;
            }
        }

    }
}

#[cfg(windows)]
async fn try_reveal_cached_hint(
    app: &AppHandle,
    pid: u32,
    game_match: &crate::game_window::GameWindowMatch,
    generation: u64,
) -> bool {
    let Some(win) = app.get_webview_window(OVERLAY_HINT_WINDOW_LABEL) else {
        return false;
    };
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    if !hint_generation_matches(&state, generation) {
        return false;
    }
    let payload = match state.overlay_hint_payload.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return false,
    };
    let Some(payload) = payload else {
        return false;
    };
    reveal_hint_on_game(app, &state, &win, pid, game_match, &payload)
        .await
        .is_ok()
}

#[cfg(windows)]
async fn wait_for_game_hwnd(pid: u32, max_secs: u64) -> Result<crate::game_window::GameWindowMatch, AppError> {
    let deadline =
        std::time::Instant::now() + Duration::from_secs(max_secs.max(1));
    let mut last_key: Option<(isize, i32, i32, i32, i32)> = None;
    let mut stable_reads = 0u8;

    loop {
        if let Some(game_match) = crate::game_window::find_game_window_with_hwnd(pid) {
            if let Some(hwnd) = game_match.hwnd.map(|h| windows::Win32::Foundation::HWND(h as _)) {
                if !crate::game_window::is_minimized(hwnd) {
                    let r = game_match.rect;
                    let key = (hwnd.0 as isize, r.x, r.y, r.width, r.height);
                    if last_key == Some(key) {
                        stable_reads = stable_reads.saturating_add(1);
                        if stable_reads >= 2 {
                            return Ok(game_match);
                        }
                    } else {
                        last_key = Some(key);
                        stable_reads = 0;
                    }
                }
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err(AppError::Other(
                "A janela do jogo ainda não apareceu — tente focar o jogo.".into(),
            ));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

async fn resolve_overlay_pid(state: &AppState) -> Result<u32, AppError> {

    let running = state.launcher.running().await;

    if running.is_empty() {

        return Err(AppError::Other(

            "Nenhum jogo em execução — inicie um jogo para usar o overlay.".into(),

        ));

    }



    let preferred = state

        .overlay_context

        .lock()

        .ok()

        .and_then(|g| g.as_ref().map(|c| c.thread_id.clone()));



    if let Some(tid) = preferred {
        if let Some(r) = running.iter().find(|r| r.thread_id == tid) {
            return Ok(normalize_game_pid(r.pid));
        }
    }

    if running.len() == 1 {
        return Ok(normalize_game_pid(running[0].pid));
    }

    #[cfg(windows)]
    for r in &running {
        let pid = normalize_game_pid(r.pid);
        if crate::game_window::game_has_window_surface(pid) {
            return Ok(pid);
        }
    }

    Ok(normalize_game_pid(running[0].pid))

}



fn attach_mode_str(mode: crate::game_window::OverlayAttachMode) -> String {
    match mode {
        crate::game_window::OverlayAttachMode::OwnedWindow => "owned_window".into(),
        crate::game_window::OverlayAttachMode::TopmostOnGame => "topmost_on_game".into(),
        crate::game_window::OverlayAttachMode::MonitorFallback => "monitor_fallback".into(),
    }
}

fn show_overlay_on_game(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    pid: u32,
    layout: &OverlayLayout,
) -> Result<OverlayAnchorStatus, AppError> {
    #[cfg(windows)]
    {
        match overlay_anchor::apply_layout_to_game_with_emit(app, window, pid, layout) {
            Ok((rect, game_match)) => Ok(OverlayAnchorStatus {
                attached: true,
                pid: Some(pid),
                game_rect: Some(rect),
                attach_mode: Some(attach_mode_str(game_match.attach_mode)),
                message: if game_match.attach_mode
                    == crate::game_window::OverlayAttachMode::MonitorFallback
                {
                    Some(
                        "Fullscreen exclusivo: overlay no monitor do jogo (pressione o atalho com o jogo em foco para melhor precisão)."
                            .into(),
                    )
                } else {
                    None
                },
            }),
            Err(msg) => Ok(OverlayAnchorStatus {
                attached: false,
                pid: Some(pid),
                game_rect: None,
                attach_mode: None,
                message: Some(msg),
            }),
        }
    }
    #[cfg(not(windows))]
    {
        match overlay_anchor::apply_layout_to_game(window, pid, layout) {
            Ok(rect) => Ok(OverlayAnchorStatus {
                attached: true,
                pid: Some(pid),
                game_rect: Some(rect),
                attach_mode: None,
                message: None,
            }),
            Err(msg) => Ok(OverlayAnchorStatus {
                attached: false,
                pid: Some(pid),
                game_rect: None,
                attach_mode: None,
                message: Some(msg),
            }),
        }
    }
}



fn emit_context(app: &AppHandle, ctx: &OverlayContext) {

    let _ = app.emit("overlay:context", ctx);

}



#[tauri::command]

pub async fn overlay_ensure(app: AppHandle) -> Result<(), AppError> {

    let _ = ensure_overlay_window(&app)?;

    Ok(())

}



#[tauri::command]

pub async fn overlay_set_context(

    app: AppHandle,

    state: State<'_, AppState>,

    context: OverlayContext,

) -> Result<(), AppError> {

    {

        let mut guard = state.overlay_context.lock().map_err(|e| {

            AppError::Other(format!("overlay_context lock: {e}"))

        })?;

        *guard = Some(context.clone());

    }

    let _ = ensure_overlay_window(&app)?;

    if let Ok(pid) = resolve_overlay_pid(&state).await {
        if let Ok(mut p) = state.overlay_target_pid.lock() {
            *p = Some(pid);
        }
    }

    emit_context(&app, &context);

    Ok(())

}



#[tauri::command]

pub async fn overlay_get_context(state: State<'_, AppState>) -> Result<Option<OverlayContext>, AppError> {

    let guard = state.overlay_context.lock().map_err(|e| {

        AppError::Other(format!("overlay_context lock: {e}"))

    })?;

    Ok(guard.clone())

}



#[tauri::command]

pub async fn overlay_get_anchor_status(

    _app: AppHandle,

    state: State<'_, AppState>,

) -> Result<OverlayAnchorStatus, AppError> {

    let pid = state

        .overlay_target_pid

        .lock()

        .ok()

        .and_then(|g| *g)

        .or(resolve_overlay_pid(&state).await.ok());



    let Some(pid) = pid else {

        return Ok(OverlayAnchorStatus {

            attached: false,

            pid: None,

            game_rect: None,

            attach_mode: None,

            message: Some("Nenhum jogo em execução.".into()),

        });

    };



    #[cfg(windows)]

    {

        if let Some(game_match) = crate::game_window::find_game_window_with_hwnd(pid) {
            return Ok(OverlayAnchorStatus {
                attached: true,
                pid: Some(pid),
                game_rect: Some(game_match.rect),
                attach_mode: Some(attach_mode_str(game_match.attach_mode)),
                message: None,
            });
        }

        if let Some(game_match) = crate::game_window::find_game_window_for_overlay(pid) {
            let attached = game_match.hwnd.is_some()
                && game_match.attach_mode
                    != crate::game_window::OverlayAttachMode::MonitorFallback;
            return Ok(OverlayAnchorStatus {
                attached,
                pid: Some(pid),
                game_rect: Some(game_match.rect),
                attach_mode: Some(attach_mode_str(game_match.attach_mode)),
                message: if attached {
                    None
                } else {
                    Some("Aguardando janela do jogo…".into())
                },
            });
        }

        return Ok(OverlayAnchorStatus {
            attached: false,
            pid: Some(pid),
            game_rect: None,
            attach_mode: None,
            message: Some("Janela do jogo ainda não detectada.".into()),
        });

    }



    #[cfg(not(windows))]

    Ok(OverlayAnchorStatus {

        attached: false,

        pid: Some(pid),

        game_rect: None,

        attach_mode: None,

        message: Some("Ancoragem no jogo requer Windows.".into()),

    })

}



#[tauri::command]

pub async fn overlay_clear_context(

    app: AppHandle,

    state: State<'_, AppState>,

) -> Result<(), AppError> {

    stop_follow(&app);

    {

        let mut guard = state.overlay_context.lock().map_err(|e| {

            AppError::Other(format!("overlay_context lock: {e}"))

        })?;

        *guard = None;

    }

    hide_game_hint(&app);

    if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {

        let _ = win.hide();

    }

    if let Ok(mut vis) = state.overlay_visible.lock() {

        *vis = false;

    }

    Ok(())

}



#[tauri::command]
pub async fn overlay_show(
    app: AppHandle,
    state: State<'_, AppState>,
    layout: OverlayLayout,
) -> Result<OverlayAnchorStatus, AppError> {
    overlay_log(Some(&app), "overlay_show: comando recebido");
    match overlay_show_inner(app.clone(), state.inner(), layout).await {
        Ok(status) => {
            overlay_log(
                Some(&app),
                format!(
                    "overlay_show: ok attached={} mode={:?}",
                    status.attached, status.attach_mode
                ),
            );
            Ok(status)
        }
        Err(e) => {
            let msg = e.to_string();
            report_overlay_failure(&app, state.inner(), msg.clone()).await;
            Err(AppError::Other(user_overlay_error(&msg)))
        }
    }
}

pub async fn overlay_show_inner(
    app: AppHandle,
    state: &AppState,
    layout: OverlayLayout,
) -> Result<OverlayAnchorStatus, AppError> {
    hide_game_hint(&app);
    cache_overlay_layout(state, &layout);
    let pid = resolve_overlay_pid(state).await?;

    let window = ensure_overlay_window(&app)?;



    if let Some(ctx) = state.overlay_context.lock().ok().and_then(|g| g.clone()) {
        emit_context(&app, &ctx);
    }

    let _ = show_overlay_on_game(&app, &window, pid, &layout)?;

    window
        .show()
        .map_err(|e| AppError::Other(format!("overlay show: {e}")))?;

    let mut status = show_overlay_on_game(&app, &window, pid, &layout)?;

    #[cfg(windows)]
    if let Ok(overlay_hwnd) = window.hwnd() {
        crate::game_window::win32_show_no_activate(overlay_hwnd);
        crate::game_window::raise_overlay(overlay_hwnd);
    }

    #[cfg(windows)]
    if !status.attached {
        if overlay_anchor::apply_tauri_layout_fallback(&window, pid, &layout).is_some() {
            if let Some(game_match) = crate::game_window::find_game_window_for_overlay(pid) {
                status.attached = game_match.hwnd.is_some()
                    && game_match.attach_mode
                        != crate::game_window::OverlayAttachMode::MonitorFallback;
                status.game_rect = Some(game_match.rect);
                status.attach_mode = Some(attach_mode_str(game_match.attach_mode));
            }
        }
    }

    let _ = window.set_focus();



    if let Ok(mut vis) = state.overlay_visible.lock() {

        *vis = true;

    }



    start_follow(app.clone(), pid, layout);

    Ok(status)

}



#[tauri::command]
pub async fn overlay_hide(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    overlay_hide_inner(app, state.inner()).await
}

async fn overlay_hide_inner(app: AppHandle, state: &AppState) -> Result<(), AppError> {
    stop_follow(&app);
    hide_game_hint(&app);

    if let Some(win) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        #[cfg(windows)]
        if let Ok(hwnd) = win.hwnd() {
            crate::game_window::win32_hide(hwnd);
        }
        let _ = win.hide();
    }

    if let Ok(mut vis) = state.overlay_visible.lock() {
        *vis = false;
    }

    Ok(())

}



#[tauri::command]

pub fn default_overlay_layout() -> OverlayLayout {
    OverlayLayout {
        display_mode: "fullscreen".into(),
        geom: None,
    }
}

fn cache_overlay_layout(state: &AppState, layout: &OverlayLayout) {
    if let Ok(mut g) = state.overlay_cached_layout.lock() {
        *g = layout.clone();
    }
}

pub fn pause_overlay_follow(state: &AppState, ms: u64) {
    if let Ok(mut g) = state.overlay_follow_paused_until.lock() {
        *g = Some(std::time::Instant::now() + Duration::from_millis(ms.max(50)));
    }
}

#[tauri::command]
pub async fn overlay_pause_follow(
    state: State<'_, AppState>,
    duration_ms: u64,
) -> Result<(), AppError> {
    pause_overlay_follow(state.inner(), duration_ms);
    Ok(())
}

#[tauri::command]
pub async fn overlay_sync_compact_from_window(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OverlayCompactGeom, AppError> {
    let window = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .ok_or_else(|| AppError::Other("Janela do overlay não encontrada.".into()))?;
    let pos = window
        .outer_position()
        .map_err(|e| AppError::Other(format!("outer_position: {e}")))?;
    let size = window
        .outer_size()
        .map_err(|e| AppError::Other(format!("outer_size: {e}")))?;

    let pid = resolve_overlay_pid(&state).await?;

    #[cfg(windows)]
    {
        let game_match = crate::game_window::find_game_window_for_overlay(pid).ok_or_else(|| {
            AppError::Other("Não foi possível localizar a janela do jogo.".into())
        })?;
        let base = game_match.rect;
        let geom = OverlayCompactGeom {
            x: pos.x as f64 - base.x as f64,
            y: pos.y as f64 - base.y as f64,
            w: size.width as f64,
            h: size.height as f64,
        };
        let layout = OverlayLayout {
            display_mode: "compact".into(),
            geom: Some(geom.clone()),
        };
        cache_overlay_layout(state.inner(), &layout);
        pause_overlay_follow(state.inner(), 600);
        return Ok(geom);
    }

    #[cfg(not(windows))]
    {
        let _ = (pos, size, pid);
        Err(AppError::Other(
            "Reposicionar overlay compacto requer Windows.".into(),
        ))
    }
}

/// Toggle using the last layout sent from the frontend (global hotkey path).
pub async fn overlay_toggle_cached(app: AppHandle, state: &AppState) -> Result<bool, AppError> {
    let layout = state
        .overlay_cached_layout
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| default_overlay_layout());
    overlay_toggle_inner(app, state, layout).await
}

async fn overlay_toggle_inner(
    app: AppHandle,
    state: &AppState,
    layout: OverlayLayout,
) -> Result<bool, AppError> {
    cache_overlay_layout(state, &layout);
    let visible = overlay_effective_visible(&app, state);
    overlay_log(
        Some(&app),
        format!("overlay_toggle: visible={visible}"),
    );
    if visible {
        overlay_hide_inner(app.clone(), state).await?;
        Ok(false)
    } else {
        match overlay_show_inner(app.clone(), state, layout).await {
            Ok(_) => Ok(true),
            Err(e) => {
                let msg = e.to_string();
                report_overlay_failure(&app, state, msg.clone()).await;
                Err(AppError::Other(user_overlay_error(&msg)))
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct OverlaySyncHotkeyResult {
    pub registered: bool,
    pub hotkey: String,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn overlay_sync_hotkey(
    app: AppHandle,
    enabled: bool,
    hotkey: String,
) -> Result<OverlaySyncHotkeyResult, AppError> {
    Ok(crate::overlay_hotkey::sync_overlay_hotkey(&app, enabled, &hotkey))
}

#[tauri::command]
pub async fn overlay_toggle(
    app: AppHandle,
    state: State<'_, AppState>,
    layout: OverlayLayout,
) -> Result<bool, AppError> {
    overlay_toggle_inner(app, &state, layout).await
}



#[tauri::command]

pub async fn overlay_is_visible(state: State<'_, AppState>) -> Result<bool, AppError> {

    Ok(state

        .overlay_visible

        .lock()

        .map(|g| *g)

        .unwrap_or(false))

}

#[tauri::command]
pub fn overlay_get_game_hint_payload(
    state: State<'_, AppState>,
) -> Result<Option<OverlayHintPayload>, AppError> {
    Ok(state
        .overlay_hint_payload
        .lock()
        .map_err(|e| AppError::Other(format!("overlay_hint_payload lock: {e}")))?
        .clone())
}

pub async fn show_game_hint_inner(
    app: &AppHandle,
    state: &AppState,
    title: String,
    hotkey: String,
    pid: u32,
) -> Result<(), AppError> {
    let pid = normalize_game_pid(pid);

    #[cfg(not(windows))]
    {
        let _ = (app, state, title, hotkey, pid);
        return Err(AppError::Other(
            "Indicador no jogo requer Windows.".into(),
        ));
    }

    let payload = OverlayHintPayload {
        title: title.clone(),
        hotkey: hotkey.clone(),
    };
    {
        let mut guard = state.overlay_hint_payload.lock().map_err(|e| {
            AppError::Other(format!("overlay_hint_payload lock: {e}"))
        })?;
        *guard = Some(payload.clone());
    }

    #[cfg(windows)]
    {
        hide_game_hint(app);
        let generation = bump_hint_generation(state);
        let window = ensure_hint_window(app)?;

        if let Some(game_match) = crate::game_window::find_game_window_with_hwnd(pid) {
            reveal_hint_on_game(app, state, &window, pid, &game_match, &payload).await?;
            return Ok(());
        }

        let app_wait = app.clone();
        tauri::async_runtime::spawn(async move {
            reveal_hint_when_ready(&app_wait, pid, generation).await;
        });
    }

    Ok(())
}

#[cfg(windows)]
pub fn schedule_launch_hint(app: AppHandle, thread_id: String, game_title: String, pid: u32) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1400)).await;
        if let Some(win) = webview_by_label(&app, OVERLAY_HINT_WINDOW_LABEL) {
            if win.is_visible().unwrap_or(false) {
                return;
            }
        }
        let state = app.state::<crate::commands::AppState>();
        let enabled = state
            .overlay_user_enabled
            .lock()
            .map(|g| *g)
            .unwrap_or(false);
        if !enabled {
            return;
        }
        let mut title = hint_title_for_thread(state.inner(), &thread_id);
        if title.is_none() {
            for _ in 0..20 {
                tokio::time::sleep(Duration::from_millis(150)).await;
                title = hint_title_for_thread(state.inner(), &thread_id);
                if title.is_some() {
                    break;
                }
            }
        }
        let title = title.unwrap_or_else(|| "Jogo".into());
        let hotkey = state
            .overlay_registered_hotkey
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "Ctrl+Shift+O".into());
        let hotkey = if hotkey.trim().is_empty() {
            "Ctrl+Shift+O".into()
        } else {
            hotkey
        };
        let resolved = normalize_game_pid(pid);
        let _ = show_game_hint_inner(&app, state.inner(), title, hotkey, resolved).await;
    });
}

#[cfg(not(windows))]
pub fn schedule_launch_hint(_app: AppHandle, _thread_id: String, _game_title: String, _pid: u32) {}

/// Payload emitido para a janela overlay-hint quando uma conquista é
/// desbloqueada (evento `overlay:achievement`).
#[derive(Debug, Clone, Serialize)]
pub struct OverlayAchievementPayload {
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "iconUrl")]
    pub icon_url: Option<String>,
    /// Posição desta conquista na fila do toast (1-based) e total na fila.
    pub index: usize,
    pub count: usize,
    #[serde(rename = "unlockedCount")]
    pub unlocked_count: u32,
    #[serde(rename = "totalCount")]
    pub total_count: u32,
}

/// Mostra uma sequência de toasts de conquista sobre a janela do jogo,
/// reusando a janela/máquina do overlay-hint (posicionamento Win32 + follow
/// + geração para cancelamento). Cada item fica ~4,3s na tela.
#[cfg(windows)]
pub async fn show_achievement_toasts(
    app: &AppHandle,
    state: &AppState,
    pid: u32,
    items: Vec<super::achievements::AchievementToastItem>,
    unlocked_count: u32,
    total_count: u32,
) -> Result<bool, AppError> {
    let pid = normalize_game_pid(pid);
    let Some(game_match) = crate::game_window::find_game_window_with_hwnd(pid)
        .or_else(|| crate::game_window::find_game_window_for_overlay(pid))
    else {
        return Ok(false);
    };

    // Toma posse da janela de hint: cancela follow/auto-hide/reveal pendentes
    // do hint de launch e invalida a geração anterior.
    hide_game_hint(app);
    let generation = bump_hint_generation(state);

    let window = ensure_hint_window(app)?;
    place_hint_on_game(&window, &game_match, true)?;
    window
        .show()
        .map_err(|e| AppError::Other(format!("achievement toast show: {e}")))?;
    let _ = place_hint_on_game(&window, &game_match, false);
    if let Ok(hwnd) = window.hwnd() {
        crate::game_window::win32_show_no_activate(hwnd);
        crate::game_window::raise_overlay(hwnd);
    }
    start_hint_follow(app.clone(), pid);

    let app_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let generation_ok = |app: &AppHandle| {
            app.try_state::<AppState>()
                .map(|s| hint_generation_matches(&s, generation))
                .unwrap_or(false)
        };
        tokio::time::sleep(Duration::from_millis(120)).await;
        let count = items.len();
        for (i, item) in items.into_iter().enumerate() {
            if !generation_ok(&app_task) {
                return;
            }
            let payload = OverlayAchievementPayload {
                title: item.title,
                description: item.description,
                icon_url: item.icon_url,
                index: i + 1,
                count,
                unlocked_count,
                total_count,
            };
            // Emite mais de uma vez, como o hint: a webview pode ainda estar
            // registrando o listener logo após a criação da janela.
            if let Some(win) = app_task.get_webview_window(OVERLAY_HINT_WINDOW_LABEL) {
                for _ in 0..3 {
                    let _ = win.emit("overlay:achievement", &payload);
                    tokio::time::sleep(Duration::from_millis(60)).await;
                }
            }
            tokio::time::sleep(Duration::from_millis(4300)).await;
        }
        if generation_ok(&app_task) {
            hide_game_hint(&app_task);
        }
    });
    Ok(true)
}

#[cfg(not(windows))]
pub async fn show_achievement_toasts(
    _app: &AppHandle,
    _state: &AppState,
    _pid: u32,
    _items: Vec<super::achievements::AchievementToastItem>,
    _unlocked_count: u32,
    _total_count: u32,
) -> Result<bool, AppError> {
    Ok(false)
}

#[tauri::command]
pub async fn overlay_show_game_hint(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    hotkey: String,
    pid: Option<u32>,
) -> Result<(), AppError> {
    let pid = match pid.filter(|p| *p > 0) {
        Some(p) => p,
        None => resolve_overlay_pid(&state).await?,
    };
    show_game_hint_inner(&app, state.inner(), title, hotkey, pid).await
}

#[tauri::command]
pub async fn overlay_hide_game_hint(app: AppHandle) -> Result<(), AppError> {
    hide_game_hint(&app);
    Ok(())
}


