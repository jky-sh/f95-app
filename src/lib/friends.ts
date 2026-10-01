import { dialog } from './dialog';
import type { TFunction } from './i18n';
import { formatIpcError } from './ipcError';
import { presenceOf, type Presence } from './memberPresence';
import type { FollowedUser, MemberCardDto } from '../types/social';

/**
 * The friends list as the Friends page and Big Picture show it: each
 * followed member with their card and presence, sorted by activity or by
 * name, and split into online now / active today / everyone else.
 */

export type FriendSort = 'activity' | 'name';

export interface FriendEntry {
  user: FollowedUser;
  /** Tooltip card (last seen, cover); null until loaded. */
  card: MemberCardDto | null;
  presence: Presence;
}

export interface FriendGroup {
  id: 'all' | 'online' | 'today' | 'others';
  /** Locale key of the section title; null for the single list sorted by name. */
  titleKey: string | null;
  items: FriendEntry[];
}

export function friendEntries(
  users: FollowedUser[],
  cards: Record<string, MemberCardDto>,
  now: number,
): FriendEntry[] {
  return users.map((user) => {
    const card = cards[user.userId] ?? null;
    return { user, card, presence: presenceOf(card?.lastSeenTs, now) };
  });
}

/** Name, title or location contains `query`; an empty query matches everyone. */
export function matchesFriend(entry: FriendEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    entry.user.username,
    entry.card?.customTitle ?? entry.user.customTitle,
    entry.card?.location ?? entry.user.location,
  ].some((v) => v?.toLowerCase().includes(q));
}

function byName(a: FriendEntry, b: FriendEntry): number {
  return a.user.username.localeCompare(b.user.username, undefined, { sensitivity: 'base' });
}

/** Most recently seen first (then by name), or alphabetical. */
export function sortFriends(entries: FriendEntry[], sort: FriendSort): FriendEntry[] {
  const byActivity = (a: FriendEntry, b: FriendEntry) =>
    (b.card?.lastSeenTs ?? 0) - (a.card?.lastSeenTs ?? 0) || byName(a, b);
  return [...entries].sort(sort === 'name' ? byName : byActivity);
}

/**
 * Sections of a sorted list: by presence when sorted by activity (empty
 * ones dropped), a single untitled one when sorted by name.
 */
export function groupFriends(sorted: FriendEntry[], sort: FriendSort): FriendGroup[] {
  if (sort === 'name') return [{ id: 'all', titleKey: null, items: sorted }];
  const groups: FriendGroup[] = [
    { id: 'online', titleKey: 'friends.group.online', items: sorted.filter((e) => e.presence === 'online') },
    { id: 'today', titleKey: 'friends.group.today', items: sorted.filter((e) => e.presence === 'today') },
    {
      id: 'others',
      titleKey: 'friends.group.others',
      items: sorted.filter((e) => e.presence === 'away' || e.presence === 'unknown'),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function countOnline(entries: FriendEntry[]): number {
  return entries.filter((e) => e.presence === 'online').length;
}

/**
 * Unfollow after asking; tells the user when F95 still shows them following
 * or the call fails. True once the member is gone from the list.
 */
export async function confirmUnfollow(
  username: string,
  unfollow: () => Promise<boolean>,
  t: TFunction,
): Promise<boolean> {
  const ok = await dialog.confirm(t('friends.unfollow.confirm', { name: username }), {
    kind: 'warning',
    confirmLabel: t('friends.unfollow.action'),
  });
  if (!ok) return false;
  try {
    if (await unfollow()) return true;
    await dialog.alert(t('friends.unfollow.stillFollowing', { name: username }), { kind: 'error' });
  } catch (err) {
    await dialog.alert(t('friends.unfollow.failed', { error: formatIpcError(err) }), { kind: 'error' });
  }
  return false;
}

/* A follow or unfollow made on a member's page: lists of who you follow
 * that stay mounted (Big Picture's Friends tab) reload. */

const followListeners = new Set<() => void>();

export function onFollowChange(listener: () => void): () => void {
  followListeners.add(listener);
  return () => {
    followListeners.delete(listener);
  };
}

export function notifyFollowChange(): void {
  for (const listener of followListeners) listener();
}
