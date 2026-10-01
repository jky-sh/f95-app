import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as downloads from '../lib/downloads';
import * as library from '../lib/library';
import * as libraries from '../lib/libraries';
import * as installVersions from '../lib/installVersions';
import { engineLabel } from '../lib/installVersions';
import * as ipc from '../lib/ipc';
import { pathsOverlap } from '../lib/paths';
import { loadDownloadSettings } from '../lib/downloadSettings';
import {
  archiveParentDir,
  extractDirForArchive,
  isArchivePath,
} from '../lib/archives';
import { dialog } from '../lib/dialog';
import { tStandalone } from '../lib/i18n';
import type { DownloadProgress, DownloadRow } from '../types/download';
import type { LibraryGame } from '../types/library';

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

function archivePathsFromDone(payload: DonePayload): string[] {
  if (payload.filePaths && payload.filePaths.length > 0) {
    return payload.filePaths.filter((p) => isArchivePath(p));
  }
  return isArchivePath(payload.filePath) ? [payload.filePath] : [];
}

/** True when the library row still points at the archive folder, not the extract dir. */
function needsExtraction(row: DownloadRow, game: LibraryGame): boolean {
  if (!row.destPath || !isArchivePath(row.destPath)) return false;
  const extractDir = extractDirForArchive(row.destPath);
  if (game.installPath === extractDir) return false;
  if (game.installStatus === 'extracting') return false;
  if (game.installStatus === 'installed' || game.installStatus === 'update_available') {
    return false;
  }
  const archiveDir = archiveParentDir(row.destPath);
  const atArchiveStage =
    !game.installPath ||
    game.installPath === archiveDir ||
    game.installPath === row.destPath;
  return (
    game.installStatus === 'downloading' ||
    game.installStatus === 'error' ||
    (game.installStatus === 'not_installed' && atArchiveStage)
  );
}

export async function runExtraction(
  threadId: string,
  archivePath: string,
  gameVersion?: string | null,
): Promise<void> {
  let game = await library.get(threadId);
  if (!game) {
    throw new Error('Jogo não está na biblioteca');
  }
  const previousInstallDir = game.installPath;
  const previousVersionLabel = game.currentVersion;
  const wasInstalled =
    game.installStatus === 'installed' || game.installStatus === 'update_available';

  try {
    await library.setStatus(threadId, 'extracting');
  } catch {
    /* row may have been removed mid-extract */
  }
  try {
    const result = await ipc.extractArchive({
      archivePath,
      gameTitle: game.title,
    });
    const cat = game.category ?? 'games';
    const mediaOnly = cat === 'comics' || cat === 'animations' || cat === 'assets';
    // Re-extracting into the same folder (older rows pointed at the exe's
    // subfolder of it) is not an update: nothing to keep, migrate or delete.
    const isUpdate =
      wasInstalled && !!previousInstallDir && !pathsOverlap(previousInstallDir, result.destDir);

    // Garante que a instalação ANTERIOR tenha registro de versão antes de a
    // linha do jogo apontar para a nova — senão o rótulo/exe dela se perdem.
    if (isUpdate && previousInstallDir) {
      try {
        await installVersions.register({
          threadId,
          version: previousVersionLabel,
          installPath: previousInstallDir,
          exePath: game.exePath,
          engine: null,
          sizeBytes: null,
        });
      } catch (err) {
        console.warn('[update] failed to register previous version', err);
      }
    }

    await library.setInstallPath(threadId, result.destDir);
    if (result.exePath) {
      await library.setExe(threadId, result.exePath, result.destDir);
    } else if (mediaOnly) {
      await library.markInstalled(threadId, result.destDir);
    } else if (cat === 'mods') {
      await library.markInstalled(threadId, result.destDir);
    } else {
      await library.setStatus(threadId, 'not_installed');
    }
    if (gameVersion) {
      await library.applyVersion(threadId, gameVersion);
    }

    // Registra a versão recém-extraída (upsert por caminho).
    try {
      await installVersions.register({
        threadId,
        version: gameVersion ?? null,
        installPath: result.destDir,
        exePath: result.exePath,
        engine: result.engine,
        sizeBytes: result.sizeBytes,
      });
    } catch (err) {
      console.warn('[extract] failed to register install version', err);
    }

    const dlSettings = await loadDownloadSettings();
    if (dlSettings.deleteArchiveAfterExtract) {
      try {
        await ipc.deletePath(archivePath);
      } catch (err) {
        console.warn('[extract] failed to delete archive', err);
      }
    }
    if (dlSettings.createShortcuts && result.exePath) {
      try {
        await ipc.createGameShortcuts({
          exePath: result.exePath,
          title: game.title,
        });
      } catch (err) {
        console.warn('[extract] failed to create shortcuts', err);
      }
    }

    if (isUpdate && previousInstallDir) {
      // Copia os saves da versão anterior quando as engines são compatíveis —
      // engines com save fora do install (Unity, Godot, persistente do Ren'Py)
      // continuam funcionando sem cópia nenhuma.
      try {
        const migration = await ipc.migrateSaves({
          oldInstallDir: previousInstallDir,
          newInstallDir: result.destDir,
        });
        if (migration.engine_mismatch) {
          console.warn(
            `[update] save migration skipped: engine changed ` +
              `${migration.old_engine} -> ${migration.new_engine}`,
          );
          await dialog.alert(
            tStandalone('dllist.saves.engineMismatch', {
              old: engineLabel(migration.old_engine),
              new: engineLabel(migration.new_engine),
            }),
            { kind: 'info' },
          );
        } else if (migration.copied > 0) {
          console.info(
            `[update] migrated ${migration.copied} save dir(s) ` +
              `(${migration.bytes_copied} bytes) from old install`,
          );
        }
      } catch (err) {
        console.warn('[update] save migration failed', err);
      }

      if (dlSettings.keepOldVersions) {
        console.info(
          '[update] keeping previous install as switchable version:',
          previousInstallDir,
        );
      } else {
        try {
          // Delete the whole previous extraction, never a folder that
          // overlaps the fresh install.
          const previousRoot = await installVersions.installRootFor(threadId, previousInstallDir);
          const safeRoots = await libraries.allPaths();
          const deleted =
            !pathsOverlap(previousRoot, result.destDir) &&
            (await ipc.deleteInstallDir({ path: previousRoot, safeRoots }));
          if (deleted) {
            await installVersions.forgetByPath(previousRoot);
          } else {
            console.warn(
              '[update] previous install overlaps the new one or is outside every install library; left in place',
              previousRoot,
            );
          }
        } catch (err) {
          console.warn('[update] failed to remove old install dir', err);
        }
      }
    }
  } catch (err) {
    console.error('[extract] failed', err);
    try {
      await library.setStatus(threadId, 'error');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

interface ResolvingPayload {
  id: number;
}
interface ResolvedPayload {
  id: number;
  fileName: string;
  fileSize: number | null;
  directUrl: string;
  destPath: string;
}
interface ProgressPayload {
  id: number;
  bytes: number;
  total: number | null;
  speedBps: number;
}
interface DonePayload {
  id: number;
  bytes: number;
  filePath: string;
  filePaths?: string[];
}
interface ErrorPayload {
  id: number;
  message: string;
  /** `dl.error.<code>` explains it in the user's language. */
  code?: string | null;
}
interface VerifiedPayload {
  id: number;
  host: string;
  pageUrl: string;
  url: string;
}

/** Backend error codes with a translated explanation. */
const DOWNLOAD_ERROR_CODES = new Set([
  'file_gone',
  'link_expired',
  'link_refused',
  'session_expired',
  'host_busy',
  'host_offline',
  'rate_limited',
  'stalled',
  'html_page',
]);

/** The translated explanation, with the host's own detail kept for reference. */
function downloadErrorText(payload: ErrorPayload): string {
  if (payload.code && DOWNLOAD_ERROR_CODES.has(payload.code)) {
    const detail = payload.message?.trim();
    const text = tStandalone(`dl.error.${payload.code}`);
    return detail ? `${text} (${detail})` : text;
  }
  return payload.message;
}

/** Rows cut short by closing the app are reconciled once per app run. */
let interruptedChecked = false;
interface ExtractProgressPayload {
  archivePath: string;
  percent: number;
}
interface ExtractDonePayload {
  archivePath: string;
}
interface NeedsBrowserPayload {
  id: number;
  url: string;
  host: string;
  captcha?: boolean;
}

export interface NeedsFileChoicePayload {
  id: number;
  threadId: string;
  libraryPath?: string | null;
  host: string;
  sourceUrl: string;
  platformGroup: string | null;
  recommendedFileId?: string | null;
  files: Array<{
    id: string;
    fileName: string;
    fileSize: number | null;
    platformLabel: string | null;
  }>;
}

export interface UseDownloadsOptions {
  onNeedsFileChoice?: (req: {
    downloadId: number;
    threadId: string;
    libraryPath?: string | null;
    host: string;
    platformGroup: string | null;
    recommendedFileId?: string | null;
    files: NeedsFileChoicePayload['files'];
  }) => void;
}

async function reconcilePendingExtractions(
  tryAutoExtract: (threadId: string, archivePath: string, gameVersion?: string | null) => Promise<void>,
): Promise<void> {
  const dlSettings = await loadDownloadSettings();
  if (!dlSettings.autoExtract) return;

  const rows = await downloads.list();
  for (const row of rows) {
    if (row.state !== 'completed' || !row.destPath || !isArchivePath(row.destPath)) continue;
    const game = await library.get(row.threadId);
    if (!game || !needsExtraction(row, game)) continue;
    await tryAutoExtract(row.threadId, row.destPath, row.gameVersion);
  }
}

export function useDownloads(options?: UseDownloadsOptions): {
  rows: DownloadRow[];
  progress: Record<number, DownloadProgress>;
  /** Percentual de extração em andamento, chaveado pelo caminho do arquivo. */
  extractProgress: Record<string, number>;
  reload: () => Promise<void>;
} {
  const [rows, setRows] = useState<DownloadRow[]>([]);
  const [progress, setProgress] = useState<Record<number, DownloadProgress>>({});
  const [extractProgress, setExtractProgress] = useState<Record<string, number>>({});
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const extractingRef = useRef(new Set<string>());

  const reload = useCallback(async () => {
    const list = await downloads.list();
    setRows(list);
    const activeIds = new Set(
      list
        .filter(
          (r) =>
            r.state === 'downloading' ||
            r.state === 'resolving' ||
            r.state === 'awaiting_choice',
        )
        .map((r) => r.id),
    );
    setProgress((p) => {
      let mutated = false;
      const out: Record<number, DownloadProgress> = {};
      for (const [k, v] of Object.entries(p)) {
        const id = Number(k);
        if (activeIds.has(id)) out[id] = v;
        else mutated = true;
      }
      return mutated ? out : p;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten: UnlistenFn[] = [];

    async function tryAutoExtract(
      threadId: string,
      archivePath: string,
      gameVersion?: string | null,
    ): Promise<void> {
      const key = `${threadId}:${archivePath}`;
      if (extractingRef.current.has(key)) return;
      extractingRef.current.add(key);
      try {
        await runExtraction(threadId, archivePath, gameVersion);
      } catch (err) {
        console.error('[extract] auto failed', err);
        await dialog.alert(
          tStandalone('dllist.extract.failed', { error: formatError(err) }),
          { kind: 'error' },
        );
      } finally {
        extractingRef.current.delete(key);
      }
    }

    reload();

    async function setup() {
      unlisten.push(
        await listen<ResolvingPayload>('download:resolving', async (e) => {
          await downloads.markResolving(e.payload.id);
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ResolvedPayload>('download:resolved', async (e) => {
          await downloads.markResolved(e.payload.id, {
            resolvedUrl: e.payload.directUrl,
            destPath: e.payload.destPath,
            bytesTotal: e.payload.fileSize,
          });
          const row = await downloads.get(e.payload.id);
          if (row) {
            try {
              await library.setStatus(row.threadId, 'downloading');
            } catch {
              /* not in library */
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ProgressPayload>('download:progress', (e) => {
          if (cancelled) return;
          setProgress((p) => ({
            ...p,
            [e.payload.id]: {
              id: e.payload.id,
              bytes: e.payload.bytes,
              total: e.payload.total,
              speedBps: e.payload.speedBps,
            },
          }));
        }),
      );
      unlisten.push(
        await listen<DonePayload>('download:done', async (e) => {
          await downloads.markDone(e.payload.id, {
            bytes: e.payload.bytes,
            filePath: e.payload.filePath,
          });
          const row = await downloads.get(e.payload.id);
          if (!row) {
            if (!cancelled) reload();
            return;
          }
          const archiveFolder = e.payload.filePath.replace(/[\\/][^\\/]+$/, '');
          try {
            await library.setInstallPath(row.threadId, archiveFolder);
          } catch {
            /* not in library */
          }
          const archivePaths = archivePathsFromDone(e.payload);
          const dlSettings = await loadDownloadSettings();
          if (dlSettings.autoExtract && archivePaths.length > 0) {
            for (const archivePath of archivePaths) {
              await tryAutoExtract(row.threadId, archivePath, row.gameVersion);
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ErrorPayload>('download:error', async (e) => {
          const liveBytes = progressRef.current[e.payload.id]?.bytes;
          await downloads.markError(e.payload.id, downloadErrorText(e.payload), liveBytes);
          const row = await downloads.get(e.payload.id);
          if (row) {
            try {
              await library.setStatus(row.threadId, 'error');
            } catch {
              /* not in library */
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ExtractProgressPayload>('extract:progress', (e) => {
          if (cancelled) return;
          setExtractProgress((p) => ({
            ...p,
            [e.payload.archivePath]: e.payload.percent,
          }));
        }),
      );
      unlisten.push(
        await listen<ExtractDonePayload>('extract:done', (e) => {
          if (cancelled) return;
          setExtractProgress((p) => {
            if (!(e.payload.archivePath in p)) return p;
            const next = { ...p };
            delete next[e.payload.archivePath];
            return next;
          });
        }),
      );
      unlisten.push(
        await listen<NeedsFileChoicePayload>('download:needs-choice', async (e) => {
          await downloads.markAwaitingChoice(e.payload.id);
          options?.onNeedsFileChoice?.({
            downloadId: e.payload.id,
            threadId: e.payload.threadId,
            libraryPath: e.payload.libraryPath,
            host: e.payload.host,
            platformGroup: e.payload.platformGroup,
            recommendedFileId: e.payload.recommendedFileId,
            files: e.payload.files,
          });
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<NeedsBrowserPayload>('download:needs-browser', async (e) => {
          await downloads.markNeedsBrowser(e.payload.id, {
            host: e.payload.host,
            url: e.payload.url,
          });
          if (e.payload.captcha) {
            try {
              await ipc.openCaptchaWindow({
                downloadId: e.payload.id,
                url: e.payload.url,
                host: e.payload.host,
                title: tStandalone('downloads.verify.windowTitle', { host: e.payload.host }),
              });
            } catch (err) {
              console.warn('[captcha] open webview failed', err);
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        // The verification window found the download link: queue the row
        // again and download it into the library it was meant for. Only a
        // row still waiting on the check: a cancelled or removed one stays
        // that way (the window closes itself after the capture).
        await listen<VerifiedPayload>('download:verified', async (e) => {
          const row = await downloads.get(e.payload.id);
          if (!row || row.state !== 'needs_browser') return;
          await downloads.markRetry(row.id);
          try {
            await ipc.downloadContinueVerified({
              id: row.id,
              sourceUrl: row.sourceUrl,
              host: e.payload.host,
              pageUrl: e.payload.pageUrl,
              link: e.payload.url,
              threadId: row.threadId,
              libraryPath: row.libraryPath,
            });
          } catch (err) {
            await downloads.markError(row.id, formatError(err));
          }
          if (!cancelled) reload();
        }),
      );

      if (!interruptedChecked) {
        interruptedChecked = true;
        try {
          const active = await ipc.downloadActiveIds();
          const n = await downloads.failInterrupted(active, tStandalone('dl.error.interrupted'));
          if (n > 0 && !cancelled) reload();
        } catch (err) {
          console.warn('[downloads] reconcile interrupted rows failed', err);
        }
      }

      if (!cancelled) {
        await reconcilePendingExtractions(tryAutoExtract);
        if (!cancelled) reload();
      }
    }
    setup();

    return () => {
      cancelled = true;
      for (const u of unlisten) u();
    };
  }, [reload, options?.onNeedsFileChoice]);

  return { rows, progress, extractProgress, reload };
}
