import * as ipc from './ipc';
import * as library from './library';
import * as notifications from './notifications';
import * as settings from './settings';
import * as updates from './updates';
import { announceGameUpdates, type FoundGameUpdate } from './updateNotifier';
import type { RssFeedItem } from '../types/rss';

/** End of the last successful poll (ms); the background scheduler reads it. */
export const KEY_RSS_LAST_POLL_AT = 'rss_last_poll_at';
export const KEY_RSS_GUIDS_SEEDED = 'rss_guids_seeded';

/** Seen entries older than this are dropped (the feed spans about a day). */
const SEEN_KEEP_DAYS = 30;

// `/threads/123/` and the usual `/threads/some-title.123/post-456`.
const THREAD_URL_RE = /\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/;

/**
 * An [UPDATE] entry's identity. The guid is the thread URL, the same for
 * every version of a game, so the version (or the date when the title has
 * none) tells one update from the next.
 */
function seenKey(item: RssFeedItem): string {
  const version = item.version ? updates.normalizeVersion(item.version) : (item.pubDate ?? '');
  return `${item.guid}#${version}`;
}

/**
 * Poll the F95 RSS feed and cross-check library games that show up with an
 * update we have not seen yet; new updates are announced (updateNotifier).
 * The very first poll only records what is in the feed, so history doesn't
 * flood the bell. Returns how many updates were new.
 */
export async function pollRssLibraryUpdates(): Promise<number> {
  const feed = await ipc.fetchRssFeed({ category: 'games' });
  const updateItems = feed.items.filter((item) => item.kind === 'update');
  if (updateItems.length === 0) {
    await settings.set(KEY_RSS_LAST_POLL_AT, String(Date.now()));
    return 0;
  }

  const seeded = (await settings.get(KEY_RSS_GUIDS_SEEDED)) === '1';
  if (!seeded) {
    await notifications.seedRssGuids(updateItems.map(seenKey));
    await settings.set(KEY_RSS_GUIDS_SEEDED, '1');
    await settings.set(KEY_RSS_LAST_POLL_AT, String(Date.now()));
    return 0;
  }

  const games = await library.list();
  const byThread = new Map(games.map((g) => [g.threadId, g]));
  const fresh: FoundGameUpdate[] = [];

  try {
    for (const item of updateItems) {
      const key = seenKey(item);
      const seen = await notifications.isRssGuidSeen(key);
      await notifications.markRssGuidSeen(key);
      if (seen) continue;

      const game = byThread.get(item.threadId);
      if (!game) continue;

      const check = await updates.checkOne(game);
      let { hasUpdate, isNew } = check;
      let version = check.latestVersion;
      if (
        !hasUpdate &&
        item.version &&
        game.currentVersion &&
        !updates.versionsEqual(item.version, game.currentVersion)
      ) {
        // The thread could not be read, or still shows the old version: go
        // by the feed.
        ({ hasUpdate, isNew } = await updates.applyLatestVersion(game, item.version));
        version = item.version;
      }
      if (hasUpdate && isNew && version) fresh.push({ game, version });
    }
  } finally {
    if (fresh.length > 0) {
      await announceGameUpdates(fresh).catch((err) =>
        console.warn('[rss] announcing updates failed', err),
      );
    }
  }

  await notifications.pruneRssSeen(SEEN_KEEP_DAYS).catch(() => undefined);
  await settings.set(KEY_RSS_LAST_POLL_AT, String(Date.now()));
  return fresh.length;
}

export function extractThreadIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(THREAD_URL_RE);
  return m ? m[1] : null;
}

export function storePathForRssItem(item: RssFeedItem): string {
  return `/store/game/${item.threadId}?cat=games`;
}
