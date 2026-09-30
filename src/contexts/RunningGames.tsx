import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import * as sessions from '../lib/sessions';
import {
  clearOverlayHintSession,
  syncOverlayForLaunch,
  syncOverlayOnExit,
} from '../lib/overlayBridge';
import type { LibraryGame } from '../types/library';

interface StartedPayload {
  threadId: string;
  sessionId: number;
  pid: number;
  exePath: string;
}

interface ExitedPayload {
  threadId: string;
  sessionId: number;
  durationSeconds: number;
  exitCode: number;
  error: string | null;
}

export interface LaunchEntry {
  game: LibraryGame;
  /** Timestamp (ms) when the launch was kicked off. Used to enforce
   *  `MIN_OVERLAY_DURATION_MS` so the user can actually read the card. */
  startedAt: number;
  /** Timestamp (ms) when Rust emitted `game:started`. Presence flips the
   *  overlay from "Launching…" → "Ready!" state. Undefined while still
   *  spawning. */
  launchedAt?: number;
}

interface RunningGamesValue {
  /** Set of thread IDs currently running. */
  running: Set<string>;
  /** PID per running thread (for diagnostics). */
  pids: Record<string, number>;
  /** When each running game started (ms), for the live play timer. */
  startedAt: Record<string, number>;
  /** Games currently in the "launching" state — between the click on Play
   *  and the moment the Rust waiter reports the process is up. The map
   *  carries the full game so an overlay can render its art/title without
   *  re-querying the library. */
  launching: Map<string, LaunchEntry>;
  /** Steam/Hydra-style launch helper. Registers the game in `launching`,
   *  creates a session row, calls the IPC, then waits for `game:started`
   *  (or a timeout) to clear it. `exeOverride` lança um executável diferente
   *  do ativo — usado pela lista de versões instaladas (jogar uma versão
   *  antiga sem trocar a ativa). */
  launch: (game: LibraryGame, exeOverride?: string) => Promise<void>;
  /** Force-clear a launching state — used by the overlay's dismiss button
   *  or when launch errors. */
  cancelLaunch: (threadId: string) => void;
  /** Re-sync from the Rust authority (e.g. after navigation). */
  refresh: () => Promise<void>;
}

const Ctx = createContext<RunningGamesValue>({
  running: new Set(),
  pids: {},
  startedAt: {},
  launching: new Map(),
  launch: async () => {},
  cancelLaunch: () => {},
  refresh: async () => {},
});

const LAUNCH_TIMEOUT_MS = 30_000;

/** Minimum visible duration of the launching overlay. Rust fires
 *  `game:started` ~200-500ms after spawn — well before the user can see
 *  the card. The card itself uses this to delay its own dismissal so
 *  the "Pronto" state shows for a beat instead of flashing. */
export const MIN_OVERLAY_DURATION_MS = 2500;

/**
 * Single source of truth for "which games are running right now". Wraps the
 * Tauri `game:started` / `game:exited` event stream and is the canonical
 * writer that updates `play_sessions` and `library_games.total_playtime_seconds`
 * when a game exits. Pages that just need to *display* running state should
 * mount the provider (done once at the AppShell level) and call
 * `useRunningGames()`.
 */
export function RunningGamesProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [pids, setPids] = useState<Record<string, number>>({});
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  const [launching, setLaunching] = useState<Map<string, LaunchEntry>>(new Map());
  const launchingRef = useRef(launching);
  launchingRef.current = launching;
  const handledExits = useRef<Set<number>>(new Set());
  const launchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const cancelLaunch = useCallback((threadId: string) => {
    setLaunching((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Map(prev);
      next.delete(threadId);
      return next;
    });
    const t = launchTimers.current.get(threadId);
    if (t) {
      clearTimeout(t);
      launchTimers.current.delete(threadId);
    }
  }, []);

  const launch = useCallback(
    async (game: LibraryGame, exeOverride?: string) => {
      const exePath = exeOverride ?? game.exePath;
      if (!exePath) {
        throw new Error('exe path not set');
      }
      const entry: LaunchEntry = { game, startedAt: Date.now() };
      // Mark launching FIRST so the overlay can render before the await.
      setLaunching((prev) => {
        const next = new Map(prev);
        next.set(game.threadId, entry);
        launchingRef.current = next;
        return next;
      });
      // Safety: if `game:started` never fires (process spawn failed quietly,
      // user closed the launcher window of a wrapper, etc.), clear the
      // overlay after a generous timeout so the UI doesn't stay locked.
      const timeoutId = setTimeout(() => {
        cancelLaunch(game.threadId);
      }, LAUNCH_TIMEOUT_MS);
      launchTimers.current.set(game.threadId, timeoutId);

      try {
        const sessionId = await sessions.create(game.threadId);
        await ipc.launchGame({
          threadId: game.threadId,
          title: game.title,
          exePath,
          sessionId,
        });
      } catch (err) {
        // Launch failed before the process is up — pull the overlay
        // immediately so the user can retry without waiting for the timeout.
        cancelLaunch(game.threadId);
        throw err;
      }
    },
    [cancelLaunch],
  );

  const refresh = useCallback(async () => {
    try {
      const list = await ipc.runningGames();
      setRunning(new Set(list.map((r) => r.threadId)));
      const map: Record<string, number> = {};
      for (const r of list) map[r.threadId] = r.pid;
      setPids(map);
      const now = Date.now();
      setStartedAt((prev) => {
        const next: Record<string, number> = {};
        for (const r of list) next[r.threadId] = prev[r.threadId] ?? now - r.elapsedSeconds * 1000;
        return next;
      });
    } catch (err) {
      console.warn('[running-games] refresh failed', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten: UnlistenFn[] = [];

    // Boot: close any session left dangling from a previous crash, then sync.
    sessions
      .closeOrphans()
      .catch((err) => console.warn('[running-games] closeOrphans failed', err))
      .then(() => refresh());

    void (async () => {
      const onStarted = await listen<StartedPayload>('game:started', (e) => {
        if (cancelled) return;
        setRunning((prev) => {
          if (prev.has(e.payload.threadId)) return prev;
          const next = new Set(prev);
          next.add(e.payload.threadId);
          return next;
        });
        setPids((prev) => ({ ...prev, [e.payload.threadId]: e.payload.pid }));
        setStartedAt((prev) =>
          prev[e.payload.threadId] ? prev : { ...prev, [e.payload.threadId]: Date.now() },
        );
        setLaunching((launchPrev) => {
          const entry = launchPrev.get(e.payload.threadId);
          if (!entry) return launchPrev;
          const next = new Map(launchPrev);
          next.set(e.payload.threadId, {
            ...entry,
            launchedAt: Date.now(),
          });
          launchingRef.current = next;
          return next;
        });

        const entry = launchingRef.current.get(e.payload.threadId);
        if (entry) {
          void syncOverlayForLaunch(entry.game, e.payload.sessionId, e.payload.pid);
        } else {
          void library.get(e.payload.threadId).then((g) => {
            if (!cancelled && g) {
              void syncOverlayForLaunch(g, e.payload.sessionId, e.payload.pid);
            }
          });
        }
      });
      if (cancelled) {
        onStarted();
        return;
      }
      unlisten.push(onStarted);

      const onExited = await listen<ExitedPayload>('game:exited', async (e) => {
        if (cancelled) return;
        // The Rust waiter fires exactly one game:exited per launch, but
        // guard anyway to keep the DB tally honest if React strict-mode
        // mounts the provider twice in dev.
        if (handledExits.current.has(e.payload.sessionId)) return;
        handledExits.current.add(e.payload.sessionId);
        clearOverlayHintSession(e.payload.sessionId);

        try {
          await sessions.close(e.payload.sessionId, e.payload.durationSeconds);
          await library.bumpPlaytime(e.payload.threadId, e.payload.durationSeconds);
        } catch (err) {
          console.error('[running-games] failed to close session', err);
        }

        setRunning((prev) => {
          if (!prev.has(e.payload.threadId)) return prev;
          const next = new Set(prev);
          next.delete(e.payload.threadId);
          const wasLast = next.size === 0;
          void syncOverlayOnExit(wasLast);
          return next;
        });
        setPids((prev) => {
          const next = { ...prev };
          delete next[e.payload.threadId];
          return next;
        });
        setStartedAt((prev) => {
          const next = { ...prev };
          delete next[e.payload.threadId];
          return next;
        });
      });
      if (cancelled) {
        onExited();
        return;
      }
      unlisten.push(onExited);
    })();

    return () => {
      cancelled = true;
      for (const u of unlisten) u();
    };
  }, [refresh]);

  // A stable value: consumers re-render when the running set changes, not
  // whenever the provider does.
  const value = useMemo(
    () => ({ running, pids, startedAt, launching, launch, cancelLaunch, refresh }),
    [running, pids, startedAt, launching, launch, cancelLaunch, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunningGames(): RunningGamesValue {
  return useContext(Ctx);
}

/** When the game started (ms) while it runs, else null. */
export function useRunningSince(threadId: string | undefined | null): number | null {
  const { startedAt } = useRunningGames();
  return threadId ? (startedAt[threadId] ?? null) : null;
}

export function useIsRunning(threadId: string | undefined | null): boolean {
  const { running } = useRunningGames();
  if (!threadId) return false;
  return running.has(threadId);
}
