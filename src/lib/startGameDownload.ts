import * as downloads from './downloads';
import * as ipc from './ipc';
import * as library from './library';
import type { GameDownload } from '../types/game';
import type { SamCategory } from '../types/sam';

export interface DownloadTarget {
  threadId: string;
  category?: SamCategory;
  title: string;
  threadUrl: string;
  thumbnailUrl: string | null;
  version: string | null;
}

/**
 * Installs or updates from one of the thread's links: the game joins the
 * library (if it is not there yet), then the link goes to the downloader,
 * into `libraryPath` (the default library when omitted).
 */
export async function startGameDownload(
  game: DownloadTarget,
  download: GameDownload,
  libraryPath?: string,
): Promise<void> {
  await library.add({
    threadId: game.threadId,
    category: game.category,
    title: game.title,
    threadUrl: game.threadUrl,
    thumbnailUrl: game.thumbnailUrl,
    currentVersion: game.version,
  });
  const row = await downloads.create({
    threadId: game.threadId,
    host: download.host,
    sourceUrl: download.url,
    gameVersion: game.version,
    libraryPath: libraryPath ?? null,
    platformGroup: download.group ?? null,
  });
  await ipc.downloadStart({
    id: row.id,
    sourceUrl: row.sourceUrl,
    threadId: row.threadId,
    libraryPath,
    platformGroup: download.group,
  });
}
