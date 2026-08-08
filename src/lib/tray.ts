/**
 * System tray icon — custom menu popup (non-native) + show/hide main window.
 */
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { Image } from '@tauri-apps/api/image';
import { TrayIcon, type TrayIconEvent } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  getAppRuntimeSettings,
  loadAppRuntimeSettings,
  subscribeAppRuntimeSettings,
} from './appRuntimeSettings';
import type { TFunction } from './i18n';
import {
  bindMainWindowClosesTrayMenu,
  hideTrayMenu,
  isTrayMenuOpen,
  openTrayMenuAt,
  registerTrayTooltipController,
  showMainWindow,
} from './trayMenu';

const TRAY_ID = 'f95-app-tray';
const TRAY_TOOLTIP = 'F95 App';

let tray: TrayIcon | null = null;
let closeUnlisten: (() => void) | null = null;
let settingsUnsub: (() => void) | null = null;
let mainFocusUnlisten: (() => void) | null = null;
let started = false;
let syncGeneration = 0;

async function hideMainWindow(): Promise<void> {
  await getCurrentWindow().hide();
}

function onTrayEvent(event: TrayIconEvent) {
  if (event.type === 'Click' && event.buttonState === 'Up') {
    if (event.button === 'Left') {
      // Never leave a tray menu covering the desktop when showing the app.
      if (isTrayMenuOpen()) {
        void hideTrayMenu().finally(() => {
          void showMainWindow();
        });
        return;
      }
      void showMainWindow();
      return;
    }
    if (event.button === 'Right') {
      void openTrayMenuAt(event.position).catch((err) => {
        console.error('[tray] open custom menu failed', err);
        void hideTrayMenu();
      });
    }
  } else if (event.type === 'DoubleClick') {
    if (isTrayMenuOpen()) void hideTrayMenu();
    void showMainWindow();
  }
}

async function resolveTrayIcon(): Promise<Image> {
  try {
    const fallback = await defaultWindowIcon();
    if (fallback) return fallback;
  } catch (err) {
    console.warn('[tray] defaultWindowIcon failed', err);
  }

  const res = await fetch('/tray-icon.png');
  if (!res.ok) {
    throw new Error(`tray icon fetch failed: HTTP ${res.status}`);
  }
  const bytes = await res.arrayBuffer();
  return Image.fromBytes(bytes);
}

async function setTrayTooltipVisible(visible: boolean): Promise<void> {
  if (!tray) return;
  try {
    await tray.setTooltip(visible ? TRAY_TOOLTIP : null);
  } catch (err) {
    console.warn('[tray] setTooltip failed', err);
  }
}

async function createTray(): Promise<void> {
  if (tray) {
    try {
      await tray.setMenu(null);
      await tray.setVisible(true);
      registerTrayTooltipController((visible) => {
        void setTrayTooltipVisible(visible);
      });
      return;
    } catch (err) {
      console.warn('[tray] existing handle stale, recreating', err);
      tray = null;
    }
  }

  // Always recreate so the JS click handler (custom menu) is attached —
  // TrayIcon.getById does not let us rebind `action`.
  const existing = await TrayIcon.getById(TRAY_ID);
  if (existing) {
    try {
      await TrayIcon.removeById(TRAY_ID);
    } catch {
      /* ignore */
    }
    tray = null;
  }

  const icon = await resolveTrayIcon();
  tray = await TrayIcon.new({
    id: TRAY_ID,
    icon,
    tooltip: TRAY_TOOLTIP,
    menu: undefined,
    showMenuOnLeftClick: false,
    action: onTrayEvent,
  });
  registerTrayTooltipController((visible) => {
    void setTrayTooltipVisible(visible);
  });
  console.info('[tray] icon created');
}

async function destroyTray(): Promise<void> {
  registerTrayTooltipController(null);
  if (!tray) return;
  try {
    await tray.close();
  } catch (err) {
    console.warn('[tray] close failed', err);
  }
  tray = null;
}

async function bindCloseToTray(enabled: boolean): Promise<void> {
  if (closeUnlisten) {
    closeUnlisten();
    closeUnlisten = null;
  }
  if (!enabled) return;
  const win = getCurrentWindow();
  closeUnlisten = await win.onCloseRequested(async (event) => {
    if (!getAppRuntimeSettings().trayIconEnabled) return;
    event.preventDefault();
    await hideMainWindow();
  });
}

async function loadRuntimeSettingsWithRetry(attempts = 8): Promise<Awaited<
  ReturnType<typeof loadAppRuntimeSettings>
>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await loadAppRuntimeSettings();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function syncTrayIcon(_t?: TFunction): Promise<void> {
  const gen = ++syncGeneration;
  try {
    const s = await loadRuntimeSettingsWithRetry();
    if (gen !== syncGeneration) return;
    if (s.trayIconEnabled) {
      await createTray();
      if (gen !== syncGeneration) return;
      await bindCloseToTray(true);
    } else {
      await destroyTray();
      if (gen !== syncGeneration) return;
      await bindCloseToTray(false);
    }
  } catch (err) {
    console.error('[tray] sync failed', err);
  }
}

/**
 * Start tray lifecycle for the main window. Safe to call once.
 * Prefer calling from AppShell after the DB-backed app UI is mounted.
 */
export function startTrayIconSync(t: TFunction): () => void {
  if (started) {
    void syncTrayIcon(t);
    return () => {};
  }
  started = true;
  // Clear any leftover tray-menu overlay from a previous buggy session.
  void hideTrayMenu();
  void syncTrayIcon(t);
  void bindMainWindowClosesTrayMenu().then((unlisten) => {
    mainFocusUnlisten = unlisten;
  });
  settingsUnsub = subscribeAppRuntimeSettings(() => {
    void syncTrayIcon(t);
  });
  return () => {
    syncGeneration += 1;
    settingsUnsub?.();
    settingsUnsub = null;
    mainFocusUnlisten?.();
    mainFocusUnlisten = null;
    if (closeUnlisten) {
      closeUnlisten();
      closeUnlisten = null;
    }
    void hideTrayMenu();
    void destroyTray();
    started = false;
  };
}

export async function isTrayIconEnabled(): Promise<boolean> {
  const s = await loadRuntimeSettingsWithRetry();
  return s.trayIconEnabled;
}

/** Title-bar close: hide when tray is on, otherwise destroy the window. */
export async function handleTitleBarClose(): Promise<void> {
  const s = await loadRuntimeSettingsWithRetry();
  if (s.trayIconEnabled) {
    await hideMainWindow();
    return;
  }
  await getCurrentWindow().close();
}
