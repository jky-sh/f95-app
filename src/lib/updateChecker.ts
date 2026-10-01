import { useSyncExternalStore } from 'react';
import * as ipc from './ipc';
import * as library from './library';
import * as settings from './settings';
import { announceGameUpdates, type FoundGameUpdate } from './updateNotifier';
import { applyLatestVersion, checkAll } from './updates';
import type { LibraryGame } from '../types/library';

/**
 * One library update check for the whole app: the Library and News pages
 * show the same progress, and the background schedule reuses a run that is
 * already going instead of starting another.
 *
 * When the last complete check is recent, it reads SAM's "latest updates"
 * list for the time since then (a few requests for the whole library): a
 * game that is not in it has not changed. Otherwise (first run, a long
 * gap, other categories) it reads each thread. Updates no earlier check
 * had flagged are announced (updateNotifier).
 */
export const KEY_UPDATES_CHECKED_AT = 'library_updates_checked_at';

/** "Updated within" ranges SAM accepts, in days. */
const SAM_WINDOWS = [1, 3, 7, 14, 30] as const;
const SAM_ROWS = 90;
/** 30 days of games is ~19 pages; stop well past that. */
const MAX_SAM_PAGES = 25;
const THREAD_DELAY_MS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
  running: boolean;
  /** catalog = SAM's latest list, threads = one request per game. */
  phase: 'catalog' | 'threads' | null;
  done: number;
  total: number;
  /** Updates flagged by the current run so far, or by the last one. */
  found: number;
  /** Of those, the ones no earlier check had flagged. */
  foundNew: number;
  /** End of the last complete check (ms). */
  checkedAt: number | null;
  /** The last run failed or was cancelled before finishing. */
  interrupted: boolean;
}

let state: UpdateCheckState = {
  running: false,
  phase: null,
  done: 0,
  total: 0,
  found: 0,
  foundNew: 0,
  checkedAt: null,
  interrupted: false,
};
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let current: Promise<UpdateCheckState> | null = null;
let checkedAtLoaded = false;

function setState(patch: Partial<UpdateCheckState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

async function loadCheckedAt(): Promise<number | null> {
  if (!checkedAtLoaded) {
    checkedAtLoaded = true;
    const raw = await settings.get(KEY_UPDATES_CHECKED_AT).catch(() => null);
    const ms = raw ? Number(raw) : NaN;
    if (Number.isFinite(ms)) setState({ checkedAt: ms });
  }
  return state.checkedAt;
}

/** Smallest SAM range covering the time since the last check, or null. */
function samWindowSince(checkedAt: number | null): number | null {
  if (!checkedAt) return null;
  const days = (Date.now() - checkedAt) / DAY_MS;
  return SAM_WINDOWS.find((w) => w >= days) ?? null;
}

export interface RunOptions {
  /**
   * Background runs only use the SAM list and skip the per-thread check:
   * with no recent check they read SAM's widest range instead.
   */
  background?: boolean;
}

/** Start a check, or join the one already running. */
export function runUpdateCheck(options: RunOptions = {}): Promise<UpdateCheckState> {
  if (current) return current;
  controller = new AbortController();
  const signal = controller.signal;
  current = run(options, signal)
    .catch((err) => {
      console.warn('[update-check] failed', err);
      setState({ interrupted: true });
    })
    .then(() => {
      setState({ running: false, phase: null });
      current = null;
      controller = null;
      return state;
    });
  return current;
}

async function run(options: RunOptions, signal: AbortSignal): Promise<void> {
  const startedAt = Date.now();
  // The last run's result stays on screen until this one starts working.
  setState({ running: true, phase: null, interrupted: false });
  const checkedAt = await loadCheckedAt();
  const games = await library.list({});
  // Background runs never start the long per-thread pass: on a first run or
  // after a long gap they read SAM's widest range, which still catches
  // everything updated within it.
  const window =
    samWindowSince(checkedAt) ?? (options.background ? SAM_WINDOWS[SAM_WINDOWS.length - 1] : null);
  const gameRows = games.filter((g) => g.category === 'games');
  const otherRows = games.filter((g) => g.category !== 'games');
  // Games: SAM's list since the last check when that is recent, else one
  // request per game. Other categories: per thread, on explicit checks.
  const viaSam = window ? gameRows : [];
  const perThread = [...(window ? [] : gameRows), ...(options.background ? [] : otherRows)];

  const tally: Tally = { found: 0, fresh: [] };
  setState({ done: 0, total: 0, found: 0, foundNew: 0 });
  try {
    if (viaSam.length > 0 && window) {
      await checkViaSam(viaSam, window, signal, tally);
    }
    if (perThread.length > 0 && !signal.aborted) {
      const byThread = new Map(perThread.map((g) => [g.threadId, g]));
      setState({ phase: 'threads', done: 0, total: perThread.length });
      await checkAll(perThread, {
        delayMs: THREAD_DELAY_MS,
        signal,
        onProgress: (done, total, result) => {
          if (result.hasUpdate) tally.found += 1;
          const game = byThread.get(result.threadId);
          if (result.isNew && game && result.latestVersion) {
            tally.fresh.push({ game, version: result.latestVersion });
          }
          setState({ done, total, found: tally.found, foundNew: tally.fresh.length });
        },
      });
    }
  } finally {
    // What was found before a failure or Cancel is real all the same.
    if (tally.fresh.length > 0) {
      await announceGameUpdates(tally.fresh).catch((err) =>
        console.warn('[update-check] announcing updates failed', err),
      );
    }
  }
  if (signal.aborted) {
    setState({ interrupted: true });
    return;
  }
  // The games category is now current up to when this run started.
  await settings.set(KEY_UPDATES_CHECKED_AT, String(startedAt));
  setState({ checkedAt: startedAt, found: tally.found, foundNew: tally.fresh.length });
}

interface Tally {
  /** Games flagged with an update. */
  found: number;
  /** The updates among them no earlier check had flagged. */
  fresh: FoundGameUpdate[];
}

/** Compare library games with SAM's list of games updated in the window. */
async function checkViaSam(
  games: LibraryGame[],
  windowDays: number,
  signal: AbortSignal,
  tally: Tally,
): Promise<void> {
  const byThread = new Map(games.map((g) => [g.threadId, g]));
  let totalPages = 1;
  setState({ phase: 'catalog', done: 0, total: 1 });
  for (let page = 1; page <= Math.min(totalPages, MAX_SAM_PAGES); page++) {
    if (signal.aborted) return;
    const result = await ipc.samList({
      category: 'games',
      sort: 'date',
      date: windowDays,
      rows: SAM_ROWS,
      page,
    });
    totalPages = result.totalPages;
    for (const item of result.items) {
      const game = byThread.get(item.threadId);
      if (!game) continue;
      byThread.delete(item.threadId);
      const { hasUpdate, isNew } = await applyLatestVersion(game, item.version);
      if (hasUpdate) tally.found += 1;
      if (isNew && item.version) tally.fresh.push({ game, version: item.version.trim() });
    }
    setState({
      done: page,
      total: Math.min(totalPages, MAX_SAM_PAGES),
      found: tally.found,
      foundNew: tally.fresh.length,
    });
    // Every library game already seen: the rest of the list can't matter.
    if (byThread.size === 0) break;
  }
}

export function cancelUpdateCheck(): void {
  controller?.abort();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void loadCheckedAt();
  return () => listeners.delete(listener);
}

/** Live state of the shared update check. */
export function useUpdateCheck(): UpdateCheckState {
  return useSyncExternalStore(subscribe, () => state);
}
