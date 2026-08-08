/**
 * Custom tray context menu — compact always-on-top popup (never fullscreen).
 * Dismiss: Escape, focus loss (event + poll), or another tray click (toggle).
 */
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { PhysicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';

export const TRAY_MENU_LABEL = 'tray-menu';
export const TRAY_MENU_ACTION_EVENT = 'tray-menu:action';
export const TRAY_MENU_OPEN_EVENT = 'tray-menu:open';

export type TrayMenuAction =
  | 'show'
  | 'library'
  | 'downloads'
  | 'settings'
  | 'changelog'
  | 'check-updates'
  | 'quit'
  | 'open-game';

export interface TrayMenuActionPayload {
  action: TrayMenuAction;
  threadId?: string;
}

export interface TrayMenuOpenPayload {
  menuWidth: number;
}

export const MENU_WIDTH = 288;
/** Tall enough that content is never clipped while we measure the real height. */
export const MENU_MEASURE_HEIGHT = 900;
export const MAX_RECENT_GAMES = 5;
const MARGIN = 8;
/** Extra CSS px so DPI rounding never leaves a 1px scrollbar gutter. */
const SIZE_PAD = 6;

let lastAppliedW = 0;
let lastAppliedH = 0;

let creating: Promise<WebviewWindow> | null = null;
let onTooltipVisible: ((visible: boolean) => void) | null = null;
let menuOpen = false;
let focusUnlisten: UnlistenFn | null = null;
let focusPoll: ReturnType<typeof setInterval> | null = null;
let lastOpenPayload: TrayMenuOpenPayload | null = null;

export function isTrayMenuOpen(): boolean {
  return menuOpen;
}

export function getLastTrayMenuOpen(): TrayMenuOpenPayload | null {
  return lastOpenPayload;
}

/** Wired from tray.ts so we can suppress the native tray tooltip while open. */
export function registerTrayTooltipController(
  fn: ((visible: boolean) => void) | null,
): void {
  onTooltipVisible = fn;
}

function stopFocusPoll(): void {
  if (focusPoll != null) {
    clearInterval(focusPoll);
    focusPoll = null;
  }
}

function startFocusPoll(win: WebviewWindow): void {
  stopFocusPoll();
  // onFocusChanged is flaky on Windows for tray popups — poll as backup.
  focusPoll = setInterval(() => {
    if (!menuOpen) {
      stopFocusPoll();
      return;
    }
    void win.isFocused().then((focused) => {
      if (!focused && menuOpen) void hideTrayMenu();
    });
  }, 120);
}

async function ensureTrayMenuWindow(): Promise<WebviewWindow> {
  const existing = await WebviewWindow.getByLabel(TRAY_MENU_LABEL);
  if (existing) {
    try {
      // Recover if an older build left a fullscreen catcher open.
      await existing.setSize(new LogicalSize(MENU_WIDTH, MENU_MEASURE_HEIGHT));
      if (!menuOpen) await existing.hide();
    } catch {
      /* ignore */
    }
    return existing;
  }
  if (creating) return creating;

  creating = (async () => {
    const win = new WebviewWindow(TRAY_MENU_LABEL, {
      url: 'index.html?window=tray-menu',
      title: '',
      width: MENU_WIDTH,
      height: MENU_MEASURE_HEIGHT,
      visible: false,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focus: true,
      shadow: false,
    });

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('tray-menu window timeout')), 8_000);
      void win.once('tauri://created', () => {
        window.clearTimeout(t);
        resolve();
      });
      void win.once('tauri://error', (e) => {
        window.clearTimeout(t);
        reject(e);
      });
    });

    return win;
  })();

  try {
    return await creating;
  } finally {
    creating = null;
  }
}

async function bindDismissOnBlur(win: WebviewWindow): Promise<void> {
  if (focusUnlisten) {
    focusUnlisten();
    focusUnlisten = null;
  }
  focusUnlisten = await win.onFocusChanged(({ payload: focused }) => {
    if (!focused && menuOpen) {
      void hideTrayMenu();
    }
  });
  startFocusPoll(win);
}

/** Open the custom tray menu near the tray click position. */
export async function openTrayMenuAt(click: PhysicalPosition): Promise<void> {
  if (menuOpen) {
    await hideTrayMenu();
    return;
  }

  const win = await ensureTrayMenuWindow();
  const monitor = (await currentMonitor()) ?? null;
  const scale = monitor?.scaleFactor ?? 1;
  // Prefer work area so the menu sits above the Windows taskbar / tray overflow.
  const area = monitor?.workArea ?? null;
  const screenW = area?.size.width ?? monitor?.size.width ?? Math.round(1920 * scale);
  const screenH = area?.size.height ?? monitor?.size.height ?? Math.round(1080 * scale);
  const originX = area?.position.x ?? monitor?.position.x ?? 0;
  const originY = area?.position.y ?? monitor?.position.y ?? 0;

  // Open tall so the panel can lay out fully; TrayMenuRoot then shrinks to content.
  lastAppliedW = 0;
  lastAppliedH = 0;
  await win.setSize(new LogicalSize(MENU_WIDTH, MENU_MEASURE_HEIGHT));

  const estH = Math.min(560, screenH / scale - 2 * MARGIN);
  let x = click.x - Math.round((MENU_WIDTH * scale) / 2);
  let y = click.y - Math.round(estH * scale) - MARGIN;
  const maxX = originX + screenW - Math.round(MENU_WIDTH * scale) - MARGIN;
  const maxY = originY + screenH - Math.round(estH * scale) - MARGIN;
  x = Math.min(Math.max(originX + MARGIN, x), maxX);
  if (y < originY + MARGIN) {
    y = click.y + MARGIN;
  }
  y = Math.min(Math.max(originY + MARGIN, y), maxY);

  lastOpenPayload = { menuWidth: MENU_WIDTH };
  await win.setPosition(new PhysicalPosition(x, y));
  await bindDismissOnBlur(win);
  onTooltipVisible?.(false);
  menuOpen = true;
  await win.show();
  await win.setFocus();
  await emit(TRAY_MENU_OPEN_EVENT, lastOpenPayload);
}

/** Resize the compact popup to match rendered panel content (called from tray window). */
export async function resizeTrayMenuTo(width: number, height: number): Promise<void> {
  const win = await WebviewWindow.getByLabel(TRAY_MENU_LABEL);
  if (!win || !menuOpen) return;
  const w = Math.max(MENU_WIDTH, Math.ceil(width) + SIZE_PAD);
  const h = Math.max(120, Math.ceil(height) + SIZE_PAD);
  // Ignore tiny jitter / scrollbar feedback loops.
  if (Math.abs(w - lastAppliedW) < 2 && Math.abs(h - lastAppliedH) < 2) return;
  lastAppliedW = w;
  lastAppliedH = h;
  await win.setSize(new LogicalSize(w, h));
  await clampTrayMenuOnScreen(win, w, h);
}

/** Keep the popup fully inside the monitor work area after content-driven resizes. */
async function clampTrayMenuOnScreen(
  win: WebviewWindow,
  logicalW: number,
  logicalH: number,
): Promise<void> {
  const monitor = (await currentMonitor()) ?? null;
  const scale = monitor?.scaleFactor ?? 1;
  const area = monitor?.workArea ?? null;
  const screenW = area?.size.width ?? monitor?.size.width ?? Math.round(1920 * scale);
  const screenH = area?.size.height ?? monitor?.size.height ?? Math.round(1080 * scale);
  const originX = area?.position.x ?? monitor?.position.x ?? 0;
  const originY = area?.position.y ?? monitor?.position.y ?? 0;

  const pos = await win.outerPosition();
  const physW = Math.round(logicalW * scale);
  const physH = Math.round(logicalH * scale);
  let x = pos.x;
  let y = pos.y;
  const maxX = originX + screenW - physW - MARGIN;
  const maxY = originY + screenH - physH - MARGIN;
  x = Math.min(Math.max(originX + MARGIN, x), maxX);
  y = Math.min(Math.max(originY + MARGIN, y), maxY);
  if (x !== pos.x || y !== pos.y) {
    await win.setPosition(new PhysicalPosition(x, y));
  }
}

export async function hideTrayMenu(): Promise<void> {
  menuOpen = false;
  stopFocusPoll();
  onTooltipVisible?.(true);
  try {
    const win = await WebviewWindow.getByLabel(TRAY_MENU_LABEL);
    if (win) {
      await win.hide();
      // Shrink so a leftover fullscreen size can never trap the desktop again.
      lastAppliedW = 0;
      lastAppliedH = 0;
      await win.setSize(new LogicalSize(MENU_WIDTH, MENU_MEASURE_HEIGHT));
    }
  } catch (err) {
    console.warn('[tray-menu] hide failed', err);
  }
}

export async function emitTrayMenuAction(
  action: TrayMenuAction,
  extras?: { threadId?: string },
): Promise<void> {
  await emit(TRAY_MENU_ACTION_EVENT, {
    action,
    ...extras,
  } satisfies TrayMenuActionPayload);
  await hideTrayMenu();
}

export async function showMainWindow(): Promise<void> {
  const main = await WebviewWindow.getByLabel('main');
  if (main) {
    await main.show();
    await main.unminimize();
    await main.setFocus();
    return;
  }
  const win = getCurrentWindow();
  await win.show();
  await win.unminimize();
  await win.setFocus();
}

export function subscribeTrayMenuActions(
  handler: (payload: TrayMenuActionPayload) => void,
): Promise<UnlistenFn> {
  return listen<TrayMenuActionPayload>(TRAY_MENU_ACTION_EVENT, (event) => {
    handler(event.payload);
  });
}

export function subscribeTrayMenuOpen(
  handler: (payload: TrayMenuOpenPayload) => void,
): Promise<UnlistenFn> {
  return listen<TrayMenuOpenPayload>(TRAY_MENU_OPEN_EVENT, (event) => {
    handler(event.payload);
  });
}

/** Call from the main window so focusing the app closes an open tray menu. */
export async function bindMainWindowClosesTrayMenu(): Promise<UnlistenFn> {
  const main = await WebviewWindow.getByLabel('main');
  if (!main) return () => {};
  return main.onFocusChanged(({ payload: focused }) => {
    if (focused && menuOpen) {
      void hideTrayMenu();
    }
  });
}
