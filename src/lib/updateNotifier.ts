/**
 * Tells the user about updates the background checks found: one bell entry
 * per game version / app version (deterministic ids, so a version that is
 * found again stays quiet), and a toast for what is new: inside the app
 * while its window is in front, from the system otherwise.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { tStandalone } from './i18n';
import * as notifications from './notifications';
import * as settings from './settings';
import {
  KEY_APP_UPDATE_NOTIFIED,
  KEY_APP_UPDATE_SKIPPED,
  loadUpdatePrefs,
} from './updateSettings';
import { isInstalled, normalizeVersion } from './updates';
import type { LibraryGame } from '../types/library';

/** Fired on `window` when the app is in front; Big Picture or the desktop shows it. */
export const APP_TOAST_EVENT = 'f95:toast';

export interface ToastGame {
  threadId: string;
  title: string;
  thumbnailUrl: string | null;
}

export type AppToast =
  | { kind: 'game_update'; title: string; body: string | null; games: ToastGame[] }
  | { kind: 'app_update'; title: string; body: string | null; version: string };

export interface FoundGameUpdate {
  /** The library row as it was before the check. */
  game: LibraryGame;
  version: string;
}

/** How many names a summary toast lists before "and N more". */
const SUMMARY_NAMES = 3;

export function gameUpdateNotificationId(threadId: string, version: string): string {
  return `upd:${threadId}:${normalizeVersion(version)}`;
}

export function appUpdateNotificationId(version: string): string {
  return `app:${version}`;
}

/** Announce updates to installed games that no earlier check had flagged. */
export async function announceGameUpdates(found: FoundGameUpdate[]): Promise<void> {
  const prefs = await loadUpdatePrefs();
  if (!prefs.gamesNotify) return;
  const added: FoundGameUpdate[] = [];
  const seen = new Set<string>();
  for (const item of found) {
    const { game } = item;
    if (!isInstalled(game) || seen.has(game.threadId)) continue;
    seen.add(game.threadId);
    const inserted = await notifications.insertIfNew({
      id: gameUpdateNotificationId(game.threadId, item.version),
      source: 'game_update',
      threadId: game.threadId,
      title: tStandalone('notify.gameUpdate.title', { game: game.title }),
      body: versionLine(game.currentVersion, item.version),
      url: `/library/game/${game.threadId}`,
      thumbnailUrl: game.thumbnailUrl,
    });
    if (inserted) added.push(item);
  }
  if (added.length === 0) return;
  notifications.emitNotificationsChanged();

  const games = added.map(({ game }) => ({
    threadId: game.threadId,
    title: game.title,
    thumbnailUrl: game.thumbnailUrl,
  }));
  if (added.length === 1) {
    const [{ game, version }] = added;
    await present({
      kind: 'game_update',
      title: tStandalone('notify.gameUpdate.title', { game: game.title }),
      body: versionLine(game.currentVersion, version),
      games,
    });
    return;
  }
  const names = games.slice(0, SUMMARY_NAMES).map((g) => g.title).join(', ');
  const rest = games.length - SUMMARY_NAMES;
  await present({
    kind: 'game_update',
    title: tStandalone('notify.gameUpdates.title', { count: games.length }),
    body: rest > 0 ? tStandalone('notify.gameUpdates.more', { names, count: rest }) : names,
    games,
  });
}

/**
 * Announce a launcher update found in the background: a bell entry once
 * per version, a toast the first time. A skipped version stays quiet.
 */
export async function announceAppUpdate(version: string): Promise<void> {
  const [skipped, notified] = await Promise.all([
    settings.get(KEY_APP_UPDATE_SKIPPED),
    settings.get(KEY_APP_UPDATE_NOTIFIED),
  ]);
  if (skipped === version) return;
  const title = tStandalone('notify.appUpdate.title', { version });
  const body = tStandalone('notify.appUpdate.body');
  const inserted = await notifications.insertIfNew({
    id: appUpdateNotificationId(version),
    source: 'app_update',
    title,
    body,
  });
  if (!inserted) return;
  notifications.emitNotificationsChanged();
  if (notified === version) return;
  await settings.set(KEY_APP_UPDATE_NOTIFIED, version);
  await present({ kind: 'app_update', title, body, version });
}

function versionLine(current: string | null, next: string): string {
  return current ? tStandalone('notify.gameUpdate.body', { from: current, to: next }) : next;
}

async function present(toast: AppToast): Promise<void> {
  if (await isWindowInFront()) {
    window.dispatchEvent(new CustomEvent<AppToast>(APP_TOAST_EVENT, { detail: toast }));
    return;
  }
  const prefs = await loadUpdatePrefs();
  if (prefs.osToast) await showSystemNotification(toast.title, toast.body);
}

/** Shown and focused: the user would see an in-app toast. */
async function isWindowInFront(): Promise<boolean> {
  try {
    const win = getCurrentWindow();
    const [visible, focused] = await Promise.all([win.isVisible(), win.isFocused()]);
    return visible && focused;
  } catch {
    return document.visibilityState === 'visible' && document.hasFocus();
  }
}

async function showSystemNotification(title: string, body: string | null): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (granted) sendNotification(body ? { title, body } : { title });
  } catch (err) {
    console.warn('[updates] system notification failed', err);
  }
}
