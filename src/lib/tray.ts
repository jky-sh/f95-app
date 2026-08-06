/**
 * System tray icon — show/hide main window and quit.
 */
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { Menu } from '@tauri-apps/api/menu';
import { TrayIcon, type TrayIconEvent } from '@tauri-apps/api/tray';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exit } from '@tauri-apps/plugin-process';
import {
  getAppRuntimeSettings,
  loadAppRuntimeSettings,
  subscribeAppRuntimeSettings,
} from './appRuntimeSettings';
import type { TFunction } from './i18n';

const TRAY_ID = 'f95-app-tray';

let tray: TrayIcon | null = null;
let closeUnlisten: (() => void) | null = null;
let settingsUnsub: (() => void) | null = null;
let started = false;

async function showMainWindow(): Promise<void> {
  const win = getCurrentWindow();
  await win.show();
  await win.unminimize();
  await win.setFocus();
}

async function hideMainWindow(): Promise<void> {
  await getCurrentWindow().hide();
}

async function buildMenu(t: TFunction): Promise<Menu> {
  return Menu.new({
    items: [
      {
        id: 'show',
        text: t('tray.show'),
        action: () => {
          void showMainWindow();
        },
      },
      {
        id: 'quit',
        text: t('tray.quit'),
        action: () => {
          void exit(0);
        },
      },
    ],
  });
}

function onTrayEvent(event: TrayIconEvent) {
  if (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Up') {
    void showMainWindow();
  } else if (event.type === 'DoubleClick') {
    void showMainWindow();
  }
}

async function createTray(t: TFunction): Promise<void> {
  if (tray) return;
  const icon = await defaultWindowIcon();
  if (!icon) {
    console.warn('[tray] default window icon unavailable');
    return;
  }
  const menu = await buildMenu(t);
  tray = await TrayIcon.new({
    id: TRAY_ID,
    icon,
    tooltip: 'F95 App',
    menu,
    showMenuOnLeftClick: false,
    action: onTrayEvent,
  });
}

async function destroyTray(): Promise<void> {
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

export async function syncTrayIcon(t: TFunction): Promise<void> {
  const s = await loadAppRuntimeSettings();
  if (s.trayIconEnabled) {
    await createTray(t);
    await bindCloseToTray(true);
  } else {
    await destroyTray();
    await bindCloseToTray(false);
  }
}

/**
 * Start tray lifecycle for the main window. Safe to call once.
 */
export function startTrayIconSync(t: TFunction): () => void {
  if (started) {
    void syncTrayIcon(t);
    return () => {};
  }
  started = true;
  void syncTrayIcon(t);
  settingsUnsub = subscribeAppRuntimeSettings(() => {
    void syncTrayIcon(t);
  });
  return () => {
    settingsUnsub?.();
    settingsUnsub = null;
    if (closeUnlisten) {
      closeUnlisten();
      closeUnlisten = null;
    }
    void destroyTray();
    started = false;
  };
}

export async function isTrayIconEnabled(): Promise<boolean> {
  const s = await loadAppRuntimeSettings();
  return s.trayIconEnabled;
}

/** Title-bar close: hide when tray is on, otherwise destroy the window. */
export async function handleTitleBarClose(): Promise<void> {
  const s = await loadAppRuntimeSettings();
  if (s.trayIconEnabled) {
    await hideMainWindow();
    return;
  }
  await getCurrentWindow().close();
}
