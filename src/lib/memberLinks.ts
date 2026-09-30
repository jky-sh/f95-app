import { extractThreadIdFromUrl } from './rssUpdates';

/** Member id from an F95 `/members/<slug>.<id>/` (or `/members/<id>/`) URL. */
export function memberIdFromUrl(url: string): string | null {
  const m = url.match(/\/members\/(?:[^/?#]*\.)?(\d+)\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

/** In-app profile route for any F95 member. */
export function memberRoute(userId: string): string {
  return `/friends/${userId}`;
}

/**
 * In-app route for an activity entry: threads open on the store page and
 * members on their in-app profile. null means "open in the browser".
 */
export function activityRoute(url: string): string | null {
  const threadId = extractThreadIdFromUrl(url);
  if (threadId) return `/store/game/${threadId}?cat=games`;
  const memberId = memberIdFromUrl(url);
  return memberId ? memberRoute(memberId) : null;
}
