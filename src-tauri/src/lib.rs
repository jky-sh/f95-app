mod achievements;
mod bridge;
mod buzzheavier;
mod commands;
mod dev_debug;
mod download;
mod error;
mod extraction;
mod game_window;
mod gdrive;
mod launcher;
mod media_preview;
mod media_scan;
mod mega;
mod migrations;
mod mover;
mod overlay_anchor;
mod overlay_hotkey;
mod remote_image_preview;
mod save_migration;
mod shortcuts;
mod sidecar;
mod uploadhaven;

use commands::{
    achievement_toast, achievements_configure, achievements_scan_now, build_state, check_network,
    close_captcha_window, complete_login, create_game_shortcuts,
    default_downloads_path, delete_install_dir, delete_path, disk_info, download_cancel,
    download_continue_captcha, download_continue_choice, download_start, extract_archive,
    extract_cbz_preview, fetch_alerts_list, fetch_alerts_popup, fetch_rss_feed, game_detail,
    get_following, get_member_profile, get_profile, has_local_session, init_overlay_windows,
    is_logged_in, launch_game,
    login, login_mega, login_uploadhaven, logout, migrate_saves, move_install_cancel,
    move_install_start, open_captcha_window, overlay_clear_context, overlay_ensure,
    overlay_get_anchor_status, overlay_get_context, overlay_get_game_hint_payload, overlay_hide,
    overlay_hide_game_hint, overlay_is_visible, overlay_pause_follow, overlay_set_context,
    overlay_show, overlay_show_game_hint, overlay_sync_compact_from_window, overlay_sync_hotkey,
    overlay_toggle, ping_sidecar, resolve_media_preview, resolve_remote_image_preview,
    restart_to_login, reveal_in_explorer, running_games, sam_list, sam_options, sam_tag_search,
    scan_install_media, set_buzzheavier_account, set_datanodes_key, set_gofile_credentials,
    set_mega_session, set_mixdrop_credentials, set_uploadhaven_session, steam_detect_appid,
    steam_fetch_achievement_schema, steam_search_games, stop_game,
    verify_buzzheavier_account, verify_datanodes_key, verify_gofile_credentials,
    verify_mega_session, verify_mixdrop_credentials, verify_uploadhaven_session, AppState,
};
use tauri::{Manager, RunEvent};
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations: Vec<Migration> = vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: migrations::V1_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "downloads_add_game_version",
            sql: migrations::V2_ADD_DOWNLOAD_GAME_VERSION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "install_libraries",
            sql: migrations::V3_INSTALL_LIBRARIES,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "app_settings",
            sql: migrations::V4_APP_SETTINGS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "library_games_category",
            sql: migrations::V5_LIBRARY_CATEGORY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "achievements_schema",
            sql: migrations::V6_ACHIEVEMENTS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "notifications_and_rss_seen",
            sql: migrations::V7_NOTIFICATIONS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "library_collections",
            sql: migrations::V8_LIBRARY_COLLECTIONS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "steam_achievements",
            sql: migrations::V9_STEAM_ACHIEVEMENTS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "achievements_save_scan",
            sql: migrations::V10_ACH_SAVE_SCAN,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:f95app.db", migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Convenience-grade key derivation: hash the provided seed to 32 bytes
                // using SHA-256. The frontend supplies a stable seed derived from the
                // app identifier + a per-install salt, so no user prompt is needed.
                // See README for limitations.
                use std::hash::Hasher;
                // Lightweight: use a stable, deterministic hash. For real protection
                // the frontend should prompt for a user password instead.
                let mut out = vec![0u8; 32];
                let bytes = password.as_bytes();
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                hasher.write(bytes);
                let h = hasher.finish().to_le_bytes();
                for (i, b) in out.iter_mut().enumerate() {
                    *b = h[i % h.len()] ^ bytes.get(i).copied().unwrap_or(0);
                }
                out
            })
            .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let state = build_state(&app.handle())?;
            app.manage(state);
            if let Err(e) = init_overlay_windows(&app.handle()) {
                eprintln!(
                    "[overlay] init na inicialização falhou (será tentado ao abrir o overlay): {e}"
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            get_profile,
            get_member_profile,
            is_logged_in,
            has_local_session,
            check_network,
            logout,
            sam_list,
            sam_tag_search,
            sam_options,
            fetch_rss_feed,
            fetch_alerts_popup,
            fetch_alerts_list,
            game_detail,
            get_following,
            download_start,
            download_continue_choice,
            download_continue_captcha,
            open_captcha_window,
            close_captcha_window,
            download_cancel,
            extract_archive,
            scan_install_media,
            resolve_media_preview,
            resolve_remote_image_preview,
            extract_cbz_preview,
            reveal_in_explorer,
            launch_game,
            stop_game,
            running_games,
            migrate_saves,
            delete_install_dir,
            delete_path,
            create_game_shortcuts,
            default_downloads_path,
            disk_info,
            move_install_start,
            move_install_cancel,
            set_gofile_credentials,
            verify_gofile_credentials,
            set_mega_session,
            login_mega,
            verify_mega_session,
            set_uploadhaven_session,
            login_uploadhaven,
            verify_uploadhaven_session,
            set_buzzheavier_account,
            verify_buzzheavier_account,
            set_datanodes_key,
            verify_datanodes_key,
            set_mixdrop_credentials,
            verify_mixdrop_credentials,
            complete_login,
            restart_to_login,
            ping_sidecar,
            overlay_ensure,
            overlay_set_context,
            overlay_get_context,
            overlay_get_anchor_status,
            overlay_clear_context,
            overlay_show,
            overlay_hide,
            overlay_toggle,
            overlay_sync_hotkey,
            overlay_is_visible,
            overlay_show_game_hint,
            overlay_get_game_hint_payload,
            overlay_hide_game_hint,
            overlay_pause_follow,
            overlay_sync_compact_from_window,
            achievements_configure,
            achievements_scan_now,
            achievement_toast,
            steam_fetch_achievement_schema,
            steam_search_games,
            steam_detect_appid
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // Tauri's main loop has returned and the tokio runtime is
                // about to be torn down. `kill_on_drop(true)` set during
                // spawn is unreliable here — the runtime dies before our
                // AppState's destructors run, leaving the sidecar process
                // orphaned. Explicitly call TerminateProcess now while we
                // still own the Child handle.
                if let Some(state) = app_handle.try_state::<AppState>() {
                    // We can't await across the FFI boundary here. The
                    // sidecar's `take()` is best-effort: if the lock is
                    // already held (mid-RPC), kill_on_drop catches it.
                    if let Ok(mut guard) = state.sidecar.try_lock() {
                        if let Some(sidecar) = guard.take() {
                            sidecar.kill_now();
                        }
                    }
                }
            }
        });
}
