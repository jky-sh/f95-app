/**
 * The launcher's own update, as every surface offers it (status bar,
 * version modal, Settings, tray, Big Picture): what the last check found,
 * when it ran, and an install in progress. Background checks only record
 * and announce an update; installing is always the user's call
 * (appUpdater.installAppUpdate).
 */
import { useSyncExternalStore } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import type { TFunction } from './i18n';
import * as notifications from './notifications';
import * as settings from './settings';
import { announceAppUpdate, appUpdateNotificationId } from './updateNotifier';
import { formatBytes } from '../types/download';
import {
  KEY_APP_UPDATE_AVAILABLE,
  KEY_APP_UPDATE_CHECKED_AT,
  KEY_APP_UPDATE_SKIPPED,
} from './updateSettings';

const CHECK_TIMEOUT_MS = 30_000;

export interface AppUpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export type AppUpdateInstall =
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' };

export interface AppUpdateState {
  currentVersion: string | null;
  /** What the last check offered (also restored from the last session). */
  available: AppUpdateInfo | null;
  /** A version the user chose to skip. */
  skipped: string | null;
  checking: boolean;
  /** End of the last check (ms). */
  checkedAt: number | null;
  install: AppUpdateInstall | null;
}

let state: AppUpdateState = {
  currentVersion: null,
  available: null,
  skipped: null,
  checking: false,
  checkedAt: null,
  install: null,
};
const listeners = new Set<() => void>();
let loaded: Promise<void> | null = null;
/** The updater's handle for `available`, needed to download and install it. */
let pending: Update | null = null;
/** The handle an install is using: no check may close it meanwhile. */
let held: Update | null = null;
let inFlight: Promise<Update | null> | null = null;

function setState(patch: Partial<AppUpdateState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

/** "1.10.0" is newer than "1.9.2"; anything after the third number is ignored. */
function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** "Downloading update 45%" (bytes when the size is unknown) / "Installing update…". */
export function installLabel(install: AppUpdateInstall, t: TFunction): string {
  if (install.phase === 'installing') return t('statusbar.updateInstalling');
  const progress = install.total
    ? `${Math.min(100, Math.round((install.downloaded / install.total) * 100))}%`
    : formatBytes(install.downloaded);
  return t('statusbar.updateDownloading', { progress });
}

/** The update to tell the user about: available and not skipped. */
export function appUpdateOffer(s: AppUpdateState): AppUpdateInfo | null {
  return s.available && s.available.version !== s.skipped ? s.available : null;
}

function loadAppUpdateState(): Promise<void> {
  loaded ??= (async () => {
    const [currentVersion, checkedRaw, availableVersion, skipped] = await Promise.all([
      getVersion().catch(() => null),
      settings.get(KEY_APP_UPDATE_CHECKED_AT),
      settings.get(KEY_APP_UPDATE_AVAILABLE),
      settings.get(KEY_APP_UPDATE_SKIPPED),
    ]);
    const checkedAt = Number(checkedRaw);
    let available: AppUpdateInfo | null = null;
    if (availableVersion && currentVersion && !isNewerVersion(availableVersion, currentVersion)) {
      // Installed since: what the bell said about it is done with.
      await settings.remove(KEY_APP_UPDATE_AVAILABLE);
      await notifications.markAllRead('app_update');
      notifications.emitNotificationsChanged();
    } else if (availableVersion) {
      available = { version: availableVersion, notes: null, date: null };
    }
    setState({
      currentVersion,
      checkedAt: Number.isFinite(checkedAt) && checkedAt > 0 ? checkedAt : null,
      available,
      skipped,
    });
  })().catch((err) => {
    loaded = null;
    console.warn('[app-update] load failed', err);
  });
  return loaded;
}

/**
 * Ask GitHub Releases for a newer launcher, or join the check already
 * running. Background checks announce what they find (once per version);
 * errors reach the caller.
 */
export function runAppUpdateCheck(options: { background?: boolean } = {}): Promise<Update | null> {
  // An install is under way: the scheduled check waits for a later tick.
  if (options.background && held) return Promise.resolve(pending);
  inFlight ??= checkNow(options.background ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function checkNow(background: boolean): Promise<Update | null> {
  await loadAppUpdateState();
  setState({ checking: true });
  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    const now = Date.now();
    // Every check returns a new handle. The old one goes, unless an install
    // started before this check ended and is using it.
    if (pending && pending !== update && pending !== held) void pending.close().catch(() => undefined);
    pending = update;
    await settings.set(KEY_APP_UPDATE_CHECKED_AT, String(now));
    if (!update) {
      await settings.remove(KEY_APP_UPDATE_AVAILABLE);
      // Up to date: an older "update available" entry is done with.
      await notifications.markAllRead('app_update');
      notifications.emitNotificationsChanged();
      setState({ available: null, checkedAt: now });
      return null;
    }
    await settings.set(KEY_APP_UPDATE_AVAILABLE, update.version);
    setState({
      available: {
        version: update.version,
        notes: update.body?.trim() || null,
        date: update.date ?? null,
      },
      checkedAt: now,
    });
    if (background) await announceAppUpdate(update.version);
    return update;
  } finally {
    setState({ checking: false });
  }
}

/** The handle from this session's last check, if it found an update. */
export function getPendingAppUpdate(): Update | null {
  return pending;
}

/**
 * Keep `update` open while an install uses it, from its first dialog to the
 * end: a check that ends meanwhile replaces `pending` but leaves this one.
 */
export function holdAppUpdate(update: Update): void {
  held = update;
}

export function releaseAppUpdate(): void {
  const update = held;
  held = null;
  // A check replaced it while it was held: nothing refers to it any more.
  if (update && update !== pending) void update.close().catch(() => undefined);
}

export function setAppUpdateInstall(install: AppUpdateInstall | null): void {
  setState({ install });
}

/** No more reminders for this version (a newer one is offered again). */
export async function skipAppUpdate(version: string): Promise<void> {
  await settings.set(KEY_APP_UPDATE_SKIPPED, version);
  setState({ skipped: version });
  await notifications.markRead(appUpdateNotificationId(version));
  notifications.emitNotificationsChanged();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  void loadAppUpdateState();
  return () => {
    listeners.delete(fn);
  };
}

export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(subscribe, () => state);
}
