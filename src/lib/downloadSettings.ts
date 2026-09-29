import * as settings from './settings';
import { formatSpeed } from '../types/download';

export interface DownloadSettings {
  autoExtract: boolean;
  speedInMbps: boolean;
  deleteArchiveAfterExtract: boolean;
  createShortcuts: boolean;
  /** Atualizar mantém a instalação anterior como versão alternável (rollback). */
  keepOldVersions: boolean;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  autoExtract: true,
  speedInMbps: false,
  deleteArchiveAfterExtract: false,
  createShortcuts: true,
  keepOldVersions: true,
};

export async function loadDownloadSettings(): Promise<DownloadSettings> {
  const [autoExtract, speedInMbps, deleteArchiveAfterExtract, createShortcuts, keepOldVersions] =
    await Promise.all([
      settings.getBool(settings.KEY_DL_AUTO_EXTRACT, DEFAULT_DOWNLOAD_SETTINGS.autoExtract),
      settings.getBool(settings.KEY_DL_SPEED_MBPS, DEFAULT_DOWNLOAD_SETTINGS.speedInMbps),
      settings.getBool(
        settings.KEY_DL_DELETE_ARCHIVE,
        DEFAULT_DOWNLOAD_SETTINGS.deleteArchiveAfterExtract,
      ),
      settings.getBool(
        settings.KEY_DL_CREATE_SHORTCUTS,
        DEFAULT_DOWNLOAD_SETTINGS.createShortcuts,
      ),
      settings.getBool(
        settings.KEY_DL_KEEP_OLD_VERSIONS,
        DEFAULT_DOWNLOAD_SETTINGS.keepOldVersions,
      ),
    ]);
  return { autoExtract, speedInMbps, deleteArchiveAfterExtract, createShortcuts, keepOldVersions };
}

export async function saveDownloadSettings(
  patch: Partial<DownloadSettings>,
): Promise<DownloadSettings> {
  const current = await loadDownloadSettings();
  const next = { ...current, ...patch };
  await Promise.all([
    settings.setBool(settings.KEY_DL_AUTO_EXTRACT, next.autoExtract),
    settings.setBool(settings.KEY_DL_SPEED_MBPS, next.speedInMbps),
    settings.setBool(settings.KEY_DL_DELETE_ARCHIVE, next.deleteArchiveAfterExtract),
    settings.setBool(settings.KEY_DL_CREATE_SHORTCUTS, next.createShortcuts),
    settings.setBool(settings.KEY_DL_KEEP_OLD_VERSIONS, next.keepOldVersions),
  ]);
  return next;
}

export function formatDownloadSpeed(bps: number, speedInMbps: boolean): string {
  if (bps <= 0) return '—';
  if (speedInMbps) {
    const mbps = bps / (1024 * 1024);
    return `${mbps.toFixed(mbps >= 10 ? 1 : 2)} MB/s`;
  }
  return formatSpeed(bps);
}
