/**
 * Preferences for the background update checks and how new updates are
 * announced, plus what the app keeps about its own updates. The launcher's
 * auto-check toggle itself stays in appRuntimeSettings.
 */
import { useSyncExternalStore } from 'react';
import * as settings from './settings';

export const KEY_GAME_UPDATES_AUTO = 'game_updates_auto';
export const KEY_GAME_UPDATES_INTERVAL_MIN = 'game_updates_interval_min';
export const KEY_GAME_UPDATES_NOTIFY = 'game_updates_notify';
export const KEY_UPDATES_OS_TOAST = 'updates_os_toast';

/** End of the last app update check (ms). */
export const KEY_APP_UPDATE_CHECKED_AT = 'app_update_checked_at';
/** Version the last check offered; the tray menu window reads it too. */
export const KEY_APP_UPDATE_AVAILABLE = 'app_update_available_version';
/** Version already announced with a toast (once per version). */
export const KEY_APP_UPDATE_NOTIFIED = 'app_update_notified_version';
/** Version the user chose to skip: no more reminders for it. */
export const KEY_APP_UPDATE_SKIPPED = 'app_update_skipped_version';

/** Choices for the game update sweep, in minutes. A sweep costs a few SAM requests. */
export const GAME_UPDATE_INTERVALS = [60, 180, 360, 720, 1440] as const;

export interface UpdatePrefs {
  /** Background game update checks (SAM's latest list and the RSS feed). */
  gamesAuto: boolean;
  gamesIntervalMin: number;
  /** Bell entries and toasts when an installed game gets an update. */
  gamesNotify: boolean;
  /** System notifications while the window is hidden or in the background. */
  osToast: boolean;
}

const DEFAULTS: UpdatePrefs = {
  gamesAuto: true,
  gamesIntervalMin: 180,
  gamesNotify: true,
  osToast: true,
};

let prefs: UpdatePrefs = DEFAULTS;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: UpdatePrefs): void {
  prefs = next;
  for (const fn of listeners) fn();
}

function parseInterval(raw: string | null): number {
  const minutes = Number(raw);
  return (GAME_UPDATE_INTERVALS as readonly number[]).includes(minutes)
    ? minutes
    : DEFAULTS.gamesIntervalMin;
}

/** The saved preferences (read once, then kept current by saveUpdatePrefs). */
export async function loadUpdatePrefs(): Promise<UpdatePrefs> {
  loading ??= Promise.all([
    settings.getBool(KEY_GAME_UPDATES_AUTO, DEFAULTS.gamesAuto),
    settings.get(KEY_GAME_UPDATES_INTERVAL_MIN),
    settings.getBool(KEY_GAME_UPDATES_NOTIFY, DEFAULTS.gamesNotify),
    settings.getBool(KEY_UPDATES_OS_TOAST, DEFAULTS.osToast),
  ])
    .then(([gamesAuto, interval, gamesNotify, osToast]) => {
      publish({ gamesAuto, gamesIntervalMin: parseInterval(interval), gamesNotify, osToast });
    })
    .catch((err) => {
      // Try again next time (the database may not be ready yet).
      loading = null;
      console.warn('[update-prefs] load failed', err);
    });
  await loading;
  return prefs;
}

export async function saveUpdatePrefs(patch: Partial<UpdatePrefs>): Promise<void> {
  await loadUpdatePrefs();
  publish({ ...prefs, ...patch });
  const writes: Promise<void>[] = [];
  if (patch.gamesAuto !== undefined) writes.push(settings.setBool(KEY_GAME_UPDATES_AUTO, patch.gamesAuto));
  if (patch.gamesIntervalMin !== undefined) {
    writes.push(settings.set(KEY_GAME_UPDATES_INTERVAL_MIN, String(patch.gamesIntervalMin)));
  }
  if (patch.gamesNotify !== undefined) writes.push(settings.setBool(KEY_GAME_UPDATES_NOTIFY, patch.gamesNotify));
  if (patch.osToast !== undefined) writes.push(settings.setBool(KEY_UPDATES_OS_TOAST, patch.osToast));
  await Promise.all(writes);
}

export function onUpdatePrefsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function subscribe(fn: () => void): () => void {
  void loadUpdatePrefs();
  return onUpdatePrefsChange(fn);
}

export function useUpdatePrefs(): UpdatePrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
