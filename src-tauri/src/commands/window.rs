use super::state::AppState;
use crate::error::AppError;
use crate::mover::MoveStartResult;
use tauri::{AppHandle, Manager, State};

/// Start moving an installed game from one library to another. Returns the
/// computed destination path + total size immediately; progress is reported
/// via `install_move:*` events.
#[tauri::command]
pub async fn move_install_start(
    app: AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    old_install_path: String,
    old_exe_path: Option<String>,
    new_library_path: String,
) -> Result<MoveStartResult, AppError> {
    state
        .mover
        .start(
            app,
            thread_id,
            old_install_path,
            old_exe_path,
            new_library_path,
        )
        .await
}

#[tauri::command]
pub async fn move_install_cancel(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<(), AppError> {
    state.mover.cancel(&thread_id).await;
    Ok(())
}

/// Steam-style window transition: the login window calls this after a
/// successful sign-in. We spawn the main window (sized for the full UI)
/// and tear down the login window - the user sees the main window appear
/// while the login one fades out.
///
/// The label `main` matches the capability declared in
/// `capabilities/default.json`, so the main window inherits all the
/// permissions (db, opener, dialog, window controls…) automatically.
#[tauri::command]
pub async fn complete_login(app: AppHandle) -> Result<(), AppError> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // 1. Ensure main window exists (idempotent - double-click Sign in
    //    doesn't spawn a second window, just shows the existing one).
    let main = if let Some(existing) = app.get_webview_window("main") {
        existing
    } else {
        WebviewWindowBuilder::new(&app, "main", WebviewUrl::App("index.html".into()))
            .title("F95 App")
            .inner_size(1200.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .decorations(false)
            .center()
            .build()
            .map_err(|e| AppError::Other(format!("create main window: {e}")))?
    };

    let _ = main.show();
    let _ = main.set_focus();

    // 2. Now close login.
    if let Some(login) = app.get_webview_window("login") {
        let _ = login.close();
    }
    Ok(())
}

/// Inverse of `complete_login`: after logout, open the login window again
/// and close the main window. Settings → Sign out wires through here.
///
/// Order matters: we ensure the login window is fully built + visible
/// BEFORE closing the main window. If we closed main first and creation
/// failed mid-way, Tauri would see zero windows and shut the app down.
#[tauri::command]
pub async fn restart_to_login(app: AppHandle) -> Result<(), AppError> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // 1. Ensure login window exists.
    //
    // The `?logout=1` query string flags this window as "came-from-logout"
    // so the React app skips the auto-login path. Otherwise a stale
    // session-file race (sidecar `close()` flushing cookies AFTER `unlink`)
    // could let `isLoggedIn` return true and bounce the user right back to
    // the main app - which is exactly the symptom the user reported.
    let login = if let Some(existing) = app.get_webview_window("login") {
        existing
    } else {
        WebviewWindowBuilder::new(&app, "login", WebviewUrl::App("index.html?logout=1".into()))
            .title("F95 App")
            .inner_size(420.0, 560.0)
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            .center()
            .build()
            .map_err(|e| AppError::Other(format!("create login window: {e}")))?
    };

    // 2. Force it to be visible + focused, in case it was hidden or
    //    we just reused an existing handle.
    let _ = login.show();
    let _ = login.unminimize();
    let _ = login.set_focus();

    // Fresh bootstrap - otherwise a reused login webview may still think
    // the user is signed in and immediately spawn main again.
    let _ = login.eval("window.location.reload();");

    // 3. NOW close main - we know login is live. Destroyed, not closed: a
    //    close goes through close-to-tray, which would only hide it, and the
    //    signed-out window would come back on the next launch (single
    //    instance) or on the controller's Big Picture shortcut.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.destroy();
    }
    Ok(())
}
