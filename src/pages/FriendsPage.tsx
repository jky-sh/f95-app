import { useMemo, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../lib/i18n';
import { dialog } from '../lib/dialog';
import { FriendCardGridSkeleton } from '../components/ui/FriendCardSkeleton';
import { Spinner } from '../components/ui/Spinner';
import { OfflineGate } from '../components/OfflineGate';
import { useContextMenu } from '../components/contextMenu';
import { FriendCard } from '../components/social/FriendCard';
import { useOffline } from '../contexts/Offline';
import { useFollowing } from '../hooks/useFollowing';
import { useMemberCards } from '../hooks/useMemberCards';
import { useNow } from '../hooks/useNow';
import { buildFriendsMenu } from '../lib/contextMenus/buildFriendsMenu';
import { formatWhen, presenceOf, type Presence } from '../lib/memberPresence';
import type { ProfileDto } from '../types';
import type { FollowedUser, MemberCardDto } from '../types/social';

type Sort = 'activity' | 'name';

interface Entry {
  user: FollowedUser;
  card: MemberCardDto | null;
  presence: Presence;
}

const NO_USERS: FollowedUser[] = [];

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

export function FriendsPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { profile } = useOutletContext<{ profile: ProfileDto }>();
  const ownerId = profile.userId ?? profile.username;
  const { isOffline } = useOffline();
  const { openContextMenu } = useContextMenu();
  const { state, refresh, unfollow } = useFollowing(ownerId, isOffline);
  const users = state.kind === 'ready' ? state.users : NO_USERS;
  const userIds = useMemo(() => users.map((u) => u.userId), [users]);
  const { cards, pending } = useMemberCards(ownerId, userIds, isOffline);
  const now = useNow();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('activity');

  const entries = useMemo<Entry[]>(
    () =>
      users.map((user) => {
        const card = cards[user.userId] ?? null;
        return { user, card, presence: presenceOf(card?.lastSeenTs, now) };
      }),
    [users, cards, now],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (e: Entry) =>
      [e.user.username, e.card?.customTitle ?? e.user.customTitle, e.card?.location ?? e.user.location].some(
        (v) => v?.toLowerCase().includes(q),
      );
    const byName = (a: Entry, b: Entry) =>
      a.user.username.localeCompare(b.user.username, undefined, { sensitivity: 'base' });
    const byActivity = (a: Entry, b: Entry) =>
      (b.card?.lastSeenTs ?? 0) - (a.card?.lastSeenTs ?? 0) || byName(a, b);
    return [...(q ? entries.filter(matches) : entries)].sort(sort === 'name' ? byName : byActivity);
  }, [entries, search, sort]);

  const sections = useMemo(() => {
    if (sort === 'name') return [{ id: 'all', title: null, items: visible }];
    return [
      { id: 'online', title: t('friends.group.online'), items: visible.filter((e) => e.presence === 'online') },
      { id: 'today', title: t('friends.group.today'), items: visible.filter((e) => e.presence === 'today') },
      {
        id: 'others',
        title: t('friends.group.others'),
        items: visible.filter((e) => e.presence === 'away' || e.presence === 'unknown'),
      },
    ].filter((s) => s.items.length > 0);
  }, [visible, sort, t]);

  const onlineCount = entries.filter((e) => e.presence === 'online').length;
  const neverLoaded = state.kind === 'ready' && state.savedAt === 0;

  async function onUnfollow(user: FollowedUser) {
    const ok = await dialog.confirm(t('friends.unfollow.confirm', { name: user.username }), {
      kind: 'warning',
      confirmLabel: t('friends.unfollow.action'),
    });
    if (!ok) return;
    try {
      if (!(await unfollow(user.userId))) {
        await dialog.alert(t('friends.unfollow.stillFollowing', { name: user.username }), { kind: 'error' });
      }
    } catch (err) {
      await dialog.alert(t('friends.unfollow.failed', { error: formatErr(err) }), { kind: 'error' });
    }
  }

  return (
    <OfflineGate allowReadOnly>
      <div className="friends-page">
        <header className="friends-header">
          <div>
            <h1 className="friends-title">{t('friends.title')}</h1>
            {state.kind === 'ready' && users.length > 0 && (
              <div className="friends-subtitle">
                {t('friends.subtitle', { count: users.length })}
                {onlineCount > 0 && (
                  <span className="friends-subtitle-online">
                    {' · '}
                    {t('friends.onlineCount', { count: onlineCount })}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="friends-header-actions">
            {state.kind === 'ready' && state.refreshing && (
              <span className="friends-updated">
                <Spinner size="sm" />
                {t('friends.refreshing')}
              </span>
            )}
            {state.kind === 'ready' && !state.refreshing && state.savedAt > 0 && (
              <span className="friends-updated">
                {t('friends.updatedAt', { when: formatWhen(state.savedAt, locale, now) })}
              </span>
            )}
            <button
              type="button"
              className="friends-btn"
              onClick={() => void refresh()}
              disabled={isOffline || state.kind === 'loading' || (state.kind === 'ready' && state.refreshing)}
            >
              {t('common.refresh')}
            </button>
          </div>
        </header>

        {state.kind === 'ready' && state.refreshError && (
          <div className="friends-notice" role="status">
            {t('friends.refreshFailed', { error: state.refreshError })}
          </div>
        )}

        {state.kind === 'loading' && <FriendCardGridSkeleton count={6} />}

        {state.kind === 'error' && (
          <div className="friends-error">
            <div>{t('friends.loadFailed', { error: state.message })}</div>
            <button type="button" className="friends-btn" onClick={() => void refresh()}>
              {t('common.refresh')}
            </button>
          </div>
        )}

        {state.kind === 'ready' && users.length === 0 && (
          <div className="friends-empty">
            {neverLoaded && isOffline ? (
              <p className="friends-empty-title">{t('friends.offlineEmpty')}</p>
            ) : (
              <>
                <p className="friends-empty-title">{t('friends.empty.title')}</p>
                <p className="friends-empty-hint">{t('friends.empty.hint')}</p>
                <button
                  type="button"
                  className="friends-btn friends-btn--accent"
                  onClick={() => void openUrl('https://f95zone.to/members/')}
                  disabled={isOffline}
                >
                  {t('friends.empty.browse')}
                </button>
              </>
            )}
          </div>
        )}

        {state.kind === 'ready' && users.length > 0 && (
          <>
            <div className="friends-toolbar">
              <input
                type="search"
                className="friends-search"
                value={search}
                placeholder={t('friends.searchPlaceholder')}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="friends-sort" role="group" aria-label={t('friends.sort.label')}>
                {(['activity', 'name'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`friends-sort-btn${sort === s ? ' is-active' : ''}`}
                    aria-pressed={sort === s}
                    onClick={() => setSort(s)}
                  >
                    {t(`friends.sort.${s}`)}
                  </button>
                ))}
              </div>
            </div>

            {visible.length === 0 && (
              <div className="friends-empty">
                <p className="friends-empty-hint">{t('friends.noMatch', { query: search.trim() })}</p>
              </div>
            )}

            {sections.map((section) => (
              <section key={section.id} className="friends-section">
                {section.title && (
                  <h2 className="friends-section-title">
                    {section.title}
                    <span className="friends-section-count">{section.items.length}</span>
                  </h2>
                )}
                <div className="friends-grid">
                  {section.items.map(({ user, card, presence }) => (
                    <FriendCard
                      key={user.userId}
                      user={user}
                      card={card}
                      loadingCard={pending.has(user.userId)}
                      presence={presence}
                      now={now}
                      onOpen={() => navigate(`/friends/${user.userId}`)}
                      onContextMenu={(e) =>
                        openContextMenu(
                          e,
                          buildFriendsMenu(user, {
                            isOffline,
                            t,
                            onViewProfile: () => navigate(`/friends/${user.userId}`),
                            onUnfollow: () => void onUnfollow(user),
                          }),
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </OfflineGate>
  );
}
