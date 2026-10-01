import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../../contexts/Offline';
import { useFollowing } from '../../../hooks/useFollowing';
import { reportFriendsSeen } from '../../../hooks/useFriendsOnline';
import { useMemberCards } from '../../../hooks/useMemberCards';
import { useNow } from '../../../hooks/useNow';
import { buildFriendsMenu } from '../../../lib/contextMenus/buildFriendsMenu';
import {
  confirmUnfollow,
  countOnline,
  friendEntries,
  groupFriends,
  onFollowChange,
  sortFriends,
  type FriendEntry,
  type FriendSort,
} from '../../../lib/friends';
import { useT } from '../../../lib/i18n';
import { formatWhen, lastSeenLabel } from '../../../lib/memberPresence';
import type { FollowedUser } from '../../../types/social';
import { Icon } from '../../ui/Icon';
import { useBp, useBpProfile } from '../BpContext';
import { BpEmpty, BpGrid, BpHeading, BpLoader } from '../BpParts';
import { BpFriendTile } from './BpSocialParts';

const NO_USERS: FollowedUser[] = [];
const SORTS: FriendSort[] = ['activity', 'name'];

/** While the tab is on screen, cards are checked again this often (online drifts). */
const CARDS_REFRESH_MS = 5 * 60 * 1000;

/**
 * The members you follow, who's online first: a tile each with their cover,
 * presence and standing. A opens their profile, X the options (unfollow…).
 */
export function BpFriends({ active }: { active: boolean }) {
  const { t, locale } = useT();
  const bp = useBp();
  const profile = useBpProfile();
  const ownerId = profile.userId ?? profile.username;
  const { isOffline } = useOffline();
  const { state, refresh, unfollow } = useFollowing(ownerId, isOffline);
  const users = state.kind === 'ready' ? state.users : NO_USERS;
  const userIds = useMemo(() => users.map((u) => u.userId), [users]);
  const [revision, setRevision] = useState(0);
  const { cards, pending } = useMemberCards(ownerId, userIds, isOffline, revision);
  const now = useNow();
  const [sort, setSort] = useState<FriendSort>('activity');
  const [art, setArt] = useState<string | null>(null);

  // The tab stays mounted, so presence would only age: check the cards
  // again whenever it comes back into view, and now and then while shown.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setRevision((r) => r + 1);
    wasActive.current = active;
  }, [active]);
  useEffect(() => {
    if (!active || isOffline) return;
    const timer = window.setInterval(() => setRevision((r) => r + 1), CARDS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, isOffline]);

  // Followed or unfollowed on a member's page: the list follows.
  useEffect(
    () =>
      onFollowChange(() => {
        if (!isOffline) void refresh();
      }),
    [refresh, isOffline],
  );

  const entries = useMemo(() => friendEntries(users, cards, now), [users, cards, now]);
  const groups = useMemo(() => groupFriends(sortFriends(entries, sort), sort), [entries, sort]);
  const online = countOnline(entries);

  // The Friends tab's online count reads the same data.
  const ready = state.kind === 'ready';
  useEffect(() => {
    if (ready) reportFriendsSeen(ownerId, users.map((u) => cards[u.userId]?.lastSeenTs ?? null));
  }, [ownerId, ready, users, cards]);

  const firstCover = useMemo(() => entries.find((e) => e.card?.coverUrl)?.card?.coverUrl ?? null, [entries]);
  useEffect(() => {
    if (!active) return;
    const target = art ?? firstCover;
    if (!target) return;
    const timer = window.setTimeout(() => bp.setBackdrop(target), 140);
    return () => window.clearTimeout(timer);
  }, [bp, active, art, firstCover]);

  const onOpen = useCallback((e: FriendEntry) => bp.push({ screen: 'friend', userId: e.user.userId }), [bp]);
  const onFocusEntry = useCallback((e: FriendEntry) => {
    // Members without a cover keep the last one behind the list.
    if (e.card?.coverUrl) setArt(e.card.coverUrl);
  }, []);
  const onOptions = useCallback(
    (e: FriendEntry) =>
      bp.openSheet({
        title: e.user.username,
        subtitle: lastSeenLabel(e.card?.lastSeenTs, t, locale) ?? e.card?.customTitle ?? e.user.customTitle,
        art: e.card?.coverUrl ?? e.card?.avatarUrl ?? e.user.avatarUrl,
        items: buildFriendsMenu(e.user, {
          isOffline,
          t,
          onViewProfile: () => bp.push({ screen: 'friend', userId: e.user.userId }),
          onUnfollow: () => void confirmUnfollow(e.user.username, () => unfollow(e.user.userId), t),
        }),
      }),
    [bp, isOffline, t, locale, unfollow],
  );

  function refreshAll() {
    void refresh();
    setRevision((r) => r + 1);
  }

  const busy = state.kind === 'loading' || (state.kind === 'ready' && state.refreshing);
  let first = true;

  return (
    <div className="bp-screen-body bp-page bp-friends" data-bp-scroll-y="">
      <header className="bp-page-head" data-bp-snap="top">
        <div className="bp-page-head-text">
          <h1 className="bp-page-title">{t('friends.title')}</h1>
          {state.kind === 'ready' && (
            <div className="bp-meta">
              {users.length > 0 && <span>{t('friends.subtitle', { count: users.length })}</span>}
              {online > 0 && <span className="bp-meta-online">{t('friends.onlineCount', { count: online })}</span>}
              {isOffline ? (
                <span>{t('nav.offline')}</span>
              ) : state.refreshing ? (
                <span>{t('friends.refreshing')}</span>
              ) : (
                state.savedAt > 0 && <span>{t('friends.updatedAt', { when: formatWhen(state.savedAt, locale, now) })}</span>
              )}
            </div>
          )}
        </div>
        <div className="bp-page-tools" data-bp-group="friends-actions" data-bp-row="">
          <button type="button" className="bp-btn bp-btn--sm bp-focusable" disabled={isOffline || busy} onClick={refreshAll}>
            <Icon name="refresh" size={18} />
            {t('common.refresh')}
          </button>
          {users.length > 1 && (
            <span className="bp-chip-row">
              <span className="bp-chip-label">{t('friends.sort.label')}</span>
              {SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="bp-chip bp-focusable"
                  aria-pressed={sort === s}
                  onClick={() => setSort(s)}
                >
                  {t(`friends.sort.${s}`)}
                </button>
              ))}
            </span>
          )}
        </div>
      </header>

      {state.kind === 'ready' && state.refreshError && (
        <p className="bp-muted">{t('friends.refreshFailed', { error: state.refreshError })}</p>
      )}

      {state.kind === 'loading' ? (
        <div className="bp-center bp-center--pad">
          <BpLoader label={t('common.loading')} />
        </div>
      ) : state.kind === 'error' ? (
        <BpEmpty
          icon="alert"
          title={t('friends.loadFailed', { error: state.message })}
          action={
            <button
              type="button"
              className="bp-btn bp-btn--primary bp-focusable"
              data-bp-autofocus=""
              disabled={isOffline}
              onClick={refreshAll}
            >
              {t('bp.store.retry')}
            </button>
          }
        />
      ) : users.length === 0 ? (
        state.savedAt === 0 && isOffline ? (
          <BpEmpty
            icon="users"
            title={t('friends.offlineEmpty')}
            action={
              <button type="button" className="bp-btn bp-focusable" data-bp-autofocus="" onClick={bp.back}>
                {t('bp.hint.back')}
              </button>
            }
          />
        ) : (
          <BpEmpty
            icon="users"
            title={t('friends.empty.title')}
            text={t('friends.empty.hint')}
            action={
              <button
                type="button"
                className="bp-btn bp-btn--primary bp-focusable"
                data-bp-autofocus=""
                disabled={isOffline}
                onClick={() => void openUrl('https://f95zone.to/members/')}
              >
                <Icon name="external" size={20} />
                {t('friends.empty.browse')}
              </button>
            }
          />
        )
      ) : (
        groups.map((group) => (
          <section key={group.id} className="bp-friends-group">
            {group.titleKey && <BpHeading title={t(group.titleKey)} count={group.items.length} />}
            <BpGrid className="bp-grid--friends">
              {group.items.map((entry, i) => {
                const autoFocus = first;
                first = false;
                return (
                  <BpFriendTile
                    key={entry.user.userId}
                    entry={entry}
                    index={i}
                    now={now}
                    pending={pending.has(entry.user.userId)}
                    autoFocus={autoFocus}
                    onOpen={onOpen}
                    onOptions={onOptions}
                    onFocusEntry={onFocusEntry}
                  />
                );
              })}
            </BpGrid>
          </section>
        ))
      )}
    </div>
  );
}
