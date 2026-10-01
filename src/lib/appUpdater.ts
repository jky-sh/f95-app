/**
 * App binary auto-update via GitHub Releases (Tauri updater plugin): the
 * manual check and the install. Background checks and what they found live
 * in appUpdateState.
 */
import { relaunch } from '@tauri-apps/plugin-process';
import type { Update } from '@tauri-apps/plugin-updater';
import * as dialog from './dialog';
import * as downloads from './downloads';
import * as ipc from './ipc';
import * as library from './library';
import {
  getPendingAppUpdate,
  holdAppUpdate,
  releaseAppUpdate,
  runAppUpdateCheck,
  setAppUpdateInstall,
} from './appUpdateState';
import { setSchedulerPaused } from './backgroundScheduler';
import type { TFunction } from './i18n';
import type { DownloadState } from '../types/download';

/** Downloads that installing (which closes the app) would cut off. */
const ACTIVE_DOWNLOADS: readonly DownloadState[] = ['pending', 'resolving', 'awaiting_choice', 'downloading'];

let installing = false;

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err
    ? String((err as { message: string }).message)
    : String(err);
}

/**
 * Manual "Check for updates" (Settings, version modal, tray). Always runs,
 * whatever the auto-check toggle says; installing still asks first.
 */
export async function checkForAppUpdateInteractive(
  t: TFunction,
): Promise<'up-to-date' | 'installed' | 'dismissed' | 'error'> {
  if (installing) return 'dismissed';
  let found: Update | null;
  try {
    found = await runAppUpdateCheck();
  } catch (err) {
    await dialog.alert(t('settings.updates.checkFailed', { error: errorMessage(err) }), {
      title: t('settings.updates.checkTitle'),
      kind: 'error',
    });
    return 'error';
  }
  if (!found) {
    await dialog.alert(t('settings.updates.upToDate'), {
      title: t('settings.updates.checkTitle'),
      kind: 'success',
    });
    return 'up-to-date';
  }
  return installAppUpdate(t);
}

/**
 * Install the update the last check found (checking again when this session
 * has none in hand). Says up front that the app will close and reopen, asks
 * again while downloads run or a game is open, then downloads, stops the
 * sidecar and hands over to the installer.
 */
export async function installAppUpdate(
  t: TFunction,
): Promise<'up-to-date' | 'installed' | 'dismissed' | 'error'> {
  if (installing) return 'dismissed';
  installing = true;
  let sidecarStopped = false;
  try {
    const update = getPendingAppUpdate() ?? (await runAppUpdateCheck());
    if (!update) {
      await dialog.alert(t('settings.updates.upToDate'), {
        title: t('settings.updates.checkTitle'),
        kind: 'success',
      });
      return 'up-to-date';
    }
    // A check while the dialogs or the download run must not close it.
    holdAppUpdate(update);
    const notes = (update.body ?? '').trim();
    const ok = await dialog.confirm(
      notes
        ? t('settings.updates.availableWithNotes', {
            version: update.version,
            notes: notes.slice(0, 800),
          })
        : t('settings.updates.available', { version: update.version }),
      {
        title: t('settings.updates.availableTitle'),
        kind: 'info',
        confirmLabel: t('settings.updates.install'),
        cancelLabel: t('settings.updates.later'),
      },
    );
    if (!ok || !(await confirmWhileBusy(t))) return 'dismissed';

    let downloaded = 0;
    let total: number | null = null;
    setAppUpdateInstall({ phase: 'downloading', downloaded, total });
    await update.download((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? null;
      else if (event.event === 'Progress') downloaded += event.data.chunkLength;
      else return;
      setAppUpdateInstall({ phase: 'downloading', downloaded, total });
    });
    setAppUpdateInstall({ phase: 'installing' });
    // The installer replaces files the sidecar holds open: stop it, and keep
    // the background checks from starting it again.
    setSchedulerPaused(true);
    sidecarStopped = true;
    await ipc.prepareAppUpdate();
    // On Windows the installer takes over here and this process exits.
    await update.install();
    await relaunch();
    return 'installed';
  } catch (err) {
    setAppUpdateInstall(null);
    if (sidecarStopped) {
      // The app keeps running: the sidecar and the checks may start again.
      setSchedulerPaused(false);
      await ipc.abortAppUpdate().catch(() => undefined);
    }
    await dialog.alert(t('settings.updates.installFailed', { error: errorMessage(err) }), {
      title: t('settings.updates.checkTitle'),
      kind: 'error',
    });
    return 'error';
  } finally {
    releaseAppUpdate();
    installing = false;
  }
}

/** Installing closes the app: make sure that is fine while things are running. */
async function confirmWhileBusy(t: TFunction): Promise<boolean> {
  const [rows, running, extracting] = await Promise.all([
    downloads.list().catch(() => []),
    ipc.runningGames().catch(() => []),
    // An archive being extracted: its download row already says completed.
    library.countByStatus(['extracting']).catch(() => 0),
  ]);
  const busy =
    rows.some((r) => ACTIVE_DOWNLOADS.includes(r.state)) || running.length > 0 || extracting > 0;
  if (!busy) return true;
  return dialog.confirm(t('settings.updates.busyActivity'), {
    title: t('settings.updates.availableTitle'),
    kind: 'warning',
    confirmLabel: t('settings.updates.installAnyway'),
    cancelLabel: t('settings.updates.later'),
  });
}
