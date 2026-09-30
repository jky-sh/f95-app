import * as ipc from './ipc';
import * as library from './library';
import * as notifications from './notifications';
import * as settings from './settings';
import * as updates from './updates';
import type { RssFeedItem } from '../types/rss';

export const KEY_RSS_LAST_POLL_AT = 'rss_last_poll_at';
export const KEY_RSS_GUIDS_SEEDED = 'rss_guids_seeded';

// `/threads/123/` and the usual `/threads/some-title.123/post-456`.
const THREAD_URL_RE = /\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/;

/**
 * Poll the F95 RSS feed, cross-check library games for updates, and enqueue
 * local notifications for newly seen [UPDATE] entries. On the first run we
 * only seed guids (no notifications) so historical items don't flood the bell.
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
    await notifications.seedRssGuids(updateItems.map((i) => i.guid));
    await settings.set(KEY_RSS_GUIDS_SEEDED, '1');
    await settings.set(KEY_RSS_LAST_POLL_AT, String(Date.now()));
    return 0;
  }

  const games = await library.list();
  const byThread = new Map(games.map((g) => [g.threadId, g]));
  let created = 0;

  for (const item of updateItems) {
    const seen = await notifications.isRssGuidSeen(item.guid);
    await notifications.markRssGuidSeen(item.guid);
    if (seen) continue;

    const game = byThread.get(item.threadId);
    if (!game) continue;

    const check = await updates.checkOne(game);
    if (!check.hasUpdate && item.version && game.currentVersion) {
      const normalizedItem = item.version.trim().toLowerCase();
      const normalizedCurrent = game.currentVersion.trim().toLowerCase();
      if (normalizedItem === normalizedCurrent) continue;
      await library.setAvailableVersion(game.threadId, item.version);
    } else if (!check.hasUpdate) {
      continue;
    }

    const notifId = `rss:${item.guid}`;
    await notifications.upsert({
      id: notifId,
      source: 'rss_library',
      threadId: item.threadId,
      title: item.displayTitle,
      body: item.version ?? game.availableVersion ?? null,
      url: `/store/game/${item.threadId}?cat=${game.category}`,
      thumbnailUrl: item.thumbnailUrl,
    });
    created += 1;
  }

  await settings.set(KEY_RSS_LAST_POLL_AT, String(Date.now()));
  return created;
}

export function extractThreadIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(THREAD_URL_RE);
  return m ? m[1] : null;
}

export function storePathForRssItem(item: RssFeedItem): string {
  return `/store/game/${item.threadId}?cat=games`;
}
