import { useSyncExternalStore } from 'react';
import { query } from '../lib/db';
import { onLibraryChange } from '../lib/library';
import type { InstallStatus } from '../types/library';

/** What the store needs to know about a game already in the library. */
export interface LibraryEntry {
  installStatus: InstallStatus;
  currentVersion: string | null;
  availableVersion: string | null;
}

export type LibraryIndex = ReadonlyMap<string, LibraryEntry>;

interface Row {
  thread_id: string;
  install_status: string;
  current_version: string | null;
  available_version: string | null;
}

let index: LibraryIndex = new Map();
const subscribers = new Set<() => void>();
let stopListening: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let loadSeq = 0;

async function load(): Promise<void> {
  const seq = ++loadSeq;
  try {
    const rows = await query<Row>(
      `SELECT thread_id, install_status, current_version, available_version FROM library_games`,
    );
    if (seq !== loadSeq) return;
    index = new Map(
      rows.map((r) => [
        r.thread_id,
        {
          installStatus: r.install_status as InstallStatus,
          currentVersion: r.current_version,
          availableVersion: r.available_version,
        },
      ]),
    );
    for (const notify of subscribers) notify();
  } catch (err) {
    console.warn('[library-index] load failed', err);
  }
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    void load();
    // Coalesce bursts (a download finishing writes the row several times).
    stopListening = onLibraryChange(() => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void load(), 50);
    });
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      stopListening?.();
      stopListening = null;
      clearTimeout(reloadTimer);
    }
  };
}

const snapshot = () => index;

/**
 * Library rows by thread id, shared by every subscriber and kept current as
 * the library changes. Empty until the first read resolves.
 */
export function useLibraryIndex(): LibraryIndex {
  return useSyncExternalStore(subscribe, snapshot);
}
