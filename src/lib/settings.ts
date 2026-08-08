/**
 * Generic key-value store backed by the `app_settings` table.
 */
import { execute, query } from './db';

export const KEY_GOFILE_TOKEN = 'gofile_token';
export const KEY_GOFILE_ACCOUNT_ID = 'gofile_account_id';
export const KEY_MEGA_SESSION = 'mega_session';
export const KEY_MEGA_EMAIL = 'mega_email';
export const KEY_UPLOADHAVEN_COOKIES = 'uploadhaven_cookies';
export const KEY_UPLOADHAVEN_EMAIL = 'uploadhaven_email';
export const KEY_UPLOADHAVEN_IS_PRO = 'uploadhaven_is_pro';
export const KEY_BUZZHEAVIER_ACCOUNT_ID = 'buzzheavier_account_id';
export const KEY_DATANODES_API_KEY = 'datanodes_api_key';
export const KEY_MIXDROP_EMAIL = 'mixdrop_api_email';
export const KEY_MIXDROP_API_KEY = 'mixdrop_api_key';

export const KEY_STORE_SCROLL_MODE = 'store_scroll_mode';

export const KEY_DL_AUTO_EXTRACT = 'dl_auto_extract';
export const KEY_DL_SPEED_MBPS = 'dl_speed_mbps';
export const KEY_DL_DELETE_ARCHIVE = 'dl_delete_archive';
export const KEY_DL_CREATE_SHORTCUTS = 'dl_create_shortcuts';

export const KEY_DEV_DEBUG_PANEL = 'dev_debug_panel';
export const KEY_DEV_DEBUG_LAYOUT = 'dev_debug_layout';
export const KEY_DEV_DEBUG_FLOAT_GEOM = 'dev_debug_float_geom';
export const KEY_DEV_DEBUG_COLLAPSED = 'dev_debug_collapsed';

export const KEY_OFFLINE_MODE_MANUAL = 'offline_mode_manual';
export const KEY_PROFILE_CACHE = 'profile_cache';

export const KEY_AUTO_UPDATE_ENABLED = 'auto_update_enabled';
export const KEY_TRAY_ICON_ENABLED = 'tray_icon_enabled';

export const KEY_ACHIEVEMENTS_NOTIFY = 'achievements_notify';
export const KEY_STEAM_API_KEY = 'steam_api_key';

export const KEY_EXP_OVERLAY_ENABLED = 'exp_overlay_enabled';
export const KEY_EXP_OVERLAY_HOTKEY = 'exp_overlay_hotkey';
export const KEY_EXP_OVERLAY_DISPLAY_MODE = 'exp_overlay_display_mode';
export const KEY_EXP_OVERLAY_COMPACT_GEOM = 'exp_overlay_compact_geom';
export const KEY_EXP_OVERLAY_BACKDROP_OPACITY = 'exp_overlay_backdrop_opacity';
export const KEY_EXP_FEATURES_JSON = 'exp_features_json';
export const KEY_EXP_BROWSER_HOME_URL = 'exp_browser_home_url';
export const KEY_EXP_OVERLAY_PANEL_LAYOUTS = 'exp_overlay_panel_layouts';

interface DbRow {
  key: string;
  value: string;
  updated_at: string;
}

export async function get(key: string): Promise<string | null> {
  const rows = await query<DbRow>(
    `SELECT * FROM app_settings WHERE key = ? LIMIT 1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function set(key: string, value: string | null): Promise<void> {
  const v = (value ?? '').trim();
  if (!v) {
    await execute(`DELETE FROM app_settings WHERE key = ?`, [key]);
    return;
  }
  await execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, v],
  );
}

export async function remove(key: string): Promise<void> {
  await execute(`DELETE FROM app_settings WHERE key = ?`, [key]);
}

export async function getBool(key: string, defaultValue: boolean): Promise<boolean> {
  const raw = await get(key);
  if (raw === null) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

export async function setBool(key: string, value: boolean): Promise<void> {
  await set(key, value ? '1' : '0');
}
