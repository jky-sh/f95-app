/**
 * App binary auto-update via GitHub Releases (Tauri updater plugin).
 */
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import * as dialog from './dialog';
import { loadAppRuntimeSettings } from './appRuntimeSettings';
import type { TFunction } from './i18n';

export type UpdateProgress =
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes: string | null }
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' }
  | { phase: 'idle' }
  | { phase: 'error'; message: string };

let checking = false;

export async function isAutoUpdateEnabled(): Promise<boolean> {
  const s = await loadAppRuntimeSettings();
  return s.autoUpdateEnabled;
}

export async function checkForAppUpdate(options?: {
  timeout?: number;
}): Promise<Update | null> {
  return check({ timeout: options?.timeout ?? 30_000 });
}

/**
 * Silent boot check. Prompts only when an update exists and auto-update is on.
 */
export async function runStartupUpdateCheck(t: TFunction): Promise<void> {
  if (checking) return;
  if (!(await isAutoUpdateEnabled())) return;
  checking = true;
  try {
    const update = await checkForAppUpdate();
    if (!update) return;
    const notes = (update.body ?? '').trim();
    const message = notes
      ? t('settings.updates.availableWithNotes', {
          version: update.version,
          notes: notes.slice(0, 800),
        })
      : t('settings.updates.available', { version: update.version });
    const ok = await dialog.confirm(message, {
      title: t('settings.updates.availableTitle'),
      kind: 'info',
      confirmLabel: t('settings.updates.install'),
      cancelLabel: t('settings.updates.later'),
    });
    if (!ok) return;
    await downloadAndInstallUpdate(update, t);
  } catch (err) {
    console.warn('[updater] startup check failed', err);
  } finally {
    checking = false;
  }
}

export async function downloadAndInstallUpdate(
  update: Update,
  t: TFunction,
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  onProgress?.({ phase: 'downloading', downloaded: 0, total: null });
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? null;
        onProgress?.({ phase: 'downloading', downloaded: 0, total });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: 'downloading', downloaded, total });
        break;
      case 'Finished':
        onProgress?.({ phase: 'installing' });
        break;
    }
  });
  await dialog.alert(t('settings.updates.installedRestart'), {
    title: t('settings.updates.installedTitle'),
    kind: 'success',
  });
  await relaunch();
}

/**
 * Manual "Check for updates" from Settings. Always runs (ignores the toggle
 * for the check itself; install still requires user confirmation).
 */
export async function checkForAppUpdateInteractive(
  t: TFunction,
  onProgress?: (p: UpdateProgress) => void,
): Promise<'up-to-date' | 'updated' | 'dismissed' | 'error'> {
  if (checking) return 'dismissed';
  checking = true;
  onProgress?.({ phase: 'checking' });
  try {
    const update = await checkForAppUpdate();
    if (!update) {
      onProgress?.({ phase: 'idle' });
      await dialog.alert(t('settings.updates.upToDate'), {
        title: t('settings.updates.checkTitle'),
        kind: 'success',
      });
      return 'up-to-date';
    }
    onProgress?.({
      phase: 'available',
      version: update.version,
      notes: update.body ?? null,
    });
    const notes = (update.body ?? '').trim();
    const message = notes
      ? t('settings.updates.availableWithNotes', {
          version: update.version,
          notes: notes.slice(0, 800),
        })
      : t('settings.updates.available', { version: update.version });
    const ok = await dialog.confirm(message, {
      title: t('settings.updates.availableTitle'),
      kind: 'info',
      confirmLabel: t('settings.updates.install'),
      cancelLabel: t('settings.updates.later'),
    });
    if (!ok) {
      onProgress?.({ phase: 'idle' });
      return 'dismissed';
    }
    await downloadAndInstallUpdate(update, t, onProgress);
    return 'updated';
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: string }).message)
        : String(err);
    onProgress?.({ phase: 'error', message });
    await dialog.alert(t('settings.updates.checkFailed', { error: message }), {
      title: t('settings.updates.checkTitle'),
      kind: 'error',
    });
    return 'error';
  } finally {
    checking = false;
    onProgress?.({ phase: 'idle' });
  }
}
