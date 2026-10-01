import { useMemo } from 'react';
import { useDownloads } from '../contexts/Downloads';
import type { DownloadState } from '../types/download';

export interface ThreadDownload {
  phase: 'queued' | 'downloading' | 'extracting';
  /** 0–100, or null while the size is unknown. */
  percent: number | null;
}

const QUEUED: readonly DownloadState[] = ['pending', 'resolving', 'awaiting_choice'];

/**
 * What each game is downloading or extracting right now, from the shared
 * download progress. One map for the whole grid, so a progress tick only
 * changes the card it belongs to.
 */
export function useDownloadsByThread(): ReadonlyMap<string, ThreadDownload> {
  const { rows, progress, extractProgress } = useDownloads();
  return useMemo(() => {
    const out = new Map<string, ThreadDownload>();
    for (const row of rows) {
      const extracting = row.destPath ? extractProgress[row.destPath] : undefined;
      if (extracting != null) {
        out.set(row.threadId, { phase: 'extracting', percent: Math.round(extracting) });
        continue;
      }
      if (out.get(row.threadId)?.phase === 'extracting') continue;
      if (row.state === 'downloading') {
        const live = progress[row.id];
        const done = live?.bytes ?? row.bytesDone;
        const total = live?.total ?? row.bytesTotal;
        out.set(row.threadId, {
          phase: 'downloading',
          percent: total ? Math.min(100, Math.floor((done / total) * 100)) : null,
        });
      } else if (QUEUED.includes(row.state) && !out.has(row.threadId)) {
        out.set(row.threadId, { phase: 'queued', percent: null });
      }
    }
    return out;
  }, [rows, progress, extractProgress]);
}
