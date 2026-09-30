import * as ipc from './ipc';
import {
  DEFAULT_OVERLAY_HOTKEY,
  getExperimentalSettings,
  isOverlayEnabled,
  loadExperimentalSettings,
} from './experimentalSettings';
import { syncOverlayHotkey } from './overlayHotkey';
import type { LibraryGame } from '../types/library';
import type { OverlayContext } from '../types/overlay';

/** Prevents duplicate concurrent hint calls for the same launch (React strict-mode). */
const hintInFlight = new Set<number>();

export function gameToOverlayContext(
  game: LibraryGame,
  sessionId: number,
): OverlayContext {
  return {
    threadId: game.threadId,
    title: game.title,
    thumbnailUrl: game.thumbnailUrl || null,
    sessionId,
  };
}

/** Poll until Win32 reports a real game HWND (not monitor fallback), up to ~20s. */
export async function waitForGameWindow(maxMs = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const st = await ipc.overlayGetAnchorStatus();
      if (st.attached && st.attachMode !== 'monitor_fallback') return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export async function syncOverlayForLaunch(
  game: LibraryGame,
  sessionId: number,
  pid: number,
): Promise<void> {
  await loadExperimentalSettings();
  if (!isOverlayEnabled()) {
    console.info('[overlay] launch sync ignorado (overlay desativado)');
    return;
  }
  if (hintInFlight.has(sessionId)) return;
  hintInFlight.add(sessionId);
  console.info('[overlay] launch sync:', game.title, 'pid=', pid);
  await syncOverlayHotkey();
  const hotkey = getExperimentalSettings().overlayHotkey.trim() || DEFAULT_OVERLAY_HOTKEY;
  await ipc.overlayEnsure();
  // The hotkey opens the overlay in the mode chosen in Settings (compact or fullscreen).
  await ipc.overlaySetLayout(ipc.buildOverlayLayout()).catch(() => {});
  await ipc.overlaySetContext(gameToOverlayContext(game, sessionId));
  await new Promise((r) => setTimeout(r, 600));
  try {
    await ipc.overlayShowGameHint({ title: game.title, hotkey, pid });
  } catch (err) {
    console.warn('[overlay] indicador falhou:', err);
  } finally {
    hintInFlight.delete(sessionId);
  }
}

export function clearOverlayHintSession(_sessionId: number): void {
  /* hint dedup is per in-flight call only */
}

export async function syncOverlayOnExit(wasLastGame: boolean): Promise<void> {
  if (!isOverlayEnabled()) return;
  await ipc.overlayHideGameHint().catch(() => {});
  await ipc.overlayHide();
  if (wasLastGame) {
    await ipc.overlayClearContext();
  }
}

export async function refreshOverlayContext(
  game: LibraryGame,
  sessionId: number,
): Promise<void> {
  if (!isOverlayEnabled()) return;
  await ipc.overlaySetContext(gameToOverlayContext(game, sessionId));
}
