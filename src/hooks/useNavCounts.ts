import { useMemo } from 'react';
import { useDownloads } from '../contexts/Downloads';
import type { DownloadState } from '../types/download';
import { useLibraryIndex } from './useLibraryIndex';

const ACTIVE: readonly DownloadState[] = ['pending', 'resolving', 'awaiting_choice', 'downloading'];

/** Counts shown next to navigation links: downloads in progress, games with an update. */
export function useNavCounts(): { downloads: number; updates: number } {
  const { rows } = useDownloads();
  const library = useLibraryIndex();
  return useMemo(() => {
    let updates = 0;
    for (const entry of library.values()) if (entry.installStatus === 'update_available') updates += 1;
    return { downloads: rows.filter((r) => ACTIVE.includes(r.state)).length, updates };
  }, [rows, library]);
}
