import { useCallback, useEffect, useRef, useState } from 'react';
import * as installVersions from '../lib/installVersions';
import * as libraries from '../lib/libraries';
import * as library from '../lib/library';
import * as sessions from '../lib/sessions';
import type { LibraryGame } from '../types/library';
import type { PlaySession } from '../types/session';

export type LibraryGameState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'missing' }
  | { kind: 'ready'; game: LibraryGame };

export interface LibraryGameSessions {
  recent: PlaySession[];
  /** All sessions, not just the recent ones listed. */
  total: number;
}

const RECENT_SESSIONS = 12;

/**
 * A library game kept current in place: the first load shows the loading
 * state, later refreshes (after an action, or when the library changes
 * anywhere in the app) swap the data without blanking the page.
 */
export function useLibraryGame(threadId: string | undefined) {
  const [state, setState] = useState<LibraryGameState>({ kind: 'loading' });
  const [playSessions, setPlaySessions] = useState<LibraryGameSessions>({ recent: [], total: 0 });
  /** Install library that holds the game's folder (for "Move"). */
  const [libraryId, setLibraryId] = useState<number | undefined>(undefined);
  /** Disk used by every installed version, when known. */
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!threadId) return;
    const seq = ++seqRef.current;
    try {
      const game = await library.get(threadId);
      if (seq !== seqRef.current) return;
      if (!game) {
        setState({ kind: 'missing' });
        return;
      }
      const [recent, total, owning, size] = await Promise.all([
        sessions.recent(threadId, RECENT_SESSIONS),
        sessions.count(threadId),
        game.installPath ? libraries.findContaining(game.installPath) : Promise.resolve(null),
        installVersions.totalSize(threadId).catch(() => null),
      ]);
      if (seq !== seqRef.current) return;
      setPlaySessions({ recent, total });
      setLibraryId(owning?.id);
      setSizeBytes(size);
      setState({ kind: 'ready', game });
    } catch (err) {
      if (seq !== seqRef.current) return;
      // A failed refresh keeps what is on screen.
      setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'error', error: err }));
    }
  }, [threadId]);

  // Another game: back to the loading state.
  useEffect(() => {
    setState({ kind: 'loading' });
    setPlaySessions({ recent: [], total: 0 });
    void refresh();
  }, [refresh]);

  // Downloads, update checks, menus and other windows write the row too.
  useEffect(() => {
    if (!threadId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = library.onLibraryChange((changed) => {
      if (changed && changed !== threadId) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 60);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [threadId, refresh]);

  return { state, sessions: playSessions, libraryId, sizeBytes, refresh };
}
