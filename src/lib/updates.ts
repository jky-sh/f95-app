import { loadGameDetail } from './gameDetailCache';
import * as library from './library';
import type { GameDetail } from '../types/game';
import type { LibraryGame } from '../types/library';

export interface UpdateCheckResult {
  threadId: string;
  /** What F95 currently advertises. Null if we couldn't read it. */
  latestVersion: string | null;
  /** Current install version on disk (per `library_games.current_version`). */
  currentVersion: string | null;
  /** True when latestVersion is a non-empty string different from current. */
  hasUpdate: boolean;
  /** An update no earlier check had flagged (a first one, or a newer version). */
  isNew: boolean;
  /** Error message if the network/parse step failed. */
  error?: string;
}

export interface LatestVersionResult {
  hasUpdate: boolean;
  isNew: boolean;
}

/**
 * Hit `gameDetail` for one game, compare versions, and update the library row.
 * Returns the comparison result without throwing (errors land in `.error`) so
 * a bulk caller can keep going past individual failures.
 */
export async function checkOne(game: LibraryGame): Promise<UpdateCheckResult> {
  const result: UpdateCheckResult = {
    threadId: game.threadId,
    latestVersion: null,
    currentVersion: game.currentVersion,
    hasUpdate: false,
    isNew: false,
  };
  let detail: GameDetail;
  try {
    // Fresh on purpose; the result also refreshes what the game pages show.
    detail = await loadGameDetail(game.threadId, { fresh: true });
  } catch (err) {
    result.error = err && typeof err === 'object' && 'message' in err
      ? String((err as { message: string }).message)
      : String(err);
    return result;
  }
  const latest = (detail.version ?? '').trim() || null;
  result.latestVersion = latest;
  const { hasUpdate, isNew } = await applyLatestVersion(game, latest);
  result.hasUpdate = hasUpdate;
  result.isNew = isNew;
  return result;
}

/**
 * Record what F95 advertises for a library game: flags an update when the
 * version differs from the installed one (or the game is installed without
 * a known version), and clears a stale notice otherwise. `isNew` compares
 * with what `game` (read before the check) had flagged, so a version that
 * was already known stays quiet.
 */
export async function applyLatestVersion(
  game: LibraryGame,
  latestVersion: string | null,
): Promise<LatestVersionResult> {
  const latest = latestVersion?.trim() || null;
  const hasInstall = !!(game.exePath || game.installPath);
  const hasUpdate =
    !!latest && (game.currentVersion ? !versionsEqual(latest, game.currentVersion) : hasInstall);
  const isNew =
    hasUpdate && !(game.availableVersion && versionsEqual(game.availableVersion, latest!));
  try {
    // No version info, no install version, or the same one: clear any old
    // notice so it doesn't linger after a manual update outside the app.
    await library.setAvailableVersion(game.threadId, hasUpdate ? latest : null);
  } catch (err) {
    console.warn('[updates] failed to write available_version', err);
  }
  return { hasUpdate, isNew };
}

/** A playable install exists, so an update to it is worth announcing. */
export function isInstalled(game: LibraryGame): boolean {
  return (
    game.installStatus === 'installed' ||
    game.installStatus === 'update_available' ||
    !!game.exePath ||
    !!game.installPath
  );
}

/**
 * Iterate `checkOne` with a small delay between requests so we don't hammer
 * F95Zone. `onProgress` fires after each game so the UI can render a counter.
 */
export async function checkAll(
  games: LibraryGame[],
  options: {
    delayMs?: number;
    onProgress?: (index: number, total: number, result: UpdateCheckResult) => void;
    signal?: AbortSignal;
  } = {},
): Promise<UpdateCheckResult[]> {
  const delay = options.delayMs ?? 600;
  const out: UpdateCheckResult[] = [];
  for (let i = 0; i < games.length; i++) {
    if (options.signal?.aborted) break;
    const r = await checkOne(games[i]);
    out.push(r);
    options.onProgress?.(i + 1, games.length, r);
    if (i < games.length - 1 && delay > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        options.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
  return out;
}

/**
 * Loose equality for F95 version strings. They come in many forms ("v0.1.8",
 * "0.1.8p", "Final 1.0", etc.) — we treat them as equal if their normalized
 * forms match (lowercased, leading "v" stripped, whitespace collapsed). Good
 * enough to suppress false positives when authors edit the OP with the same
 * version but different formatting.
 */
export function versionsEqual(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b);
}

/** The form `versionsEqual` compares (also used in ids keyed by version). */
export function normalizeVersion(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^v(?=\d)/, '');
}
