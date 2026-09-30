import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as ipc from '../../lib/ipc';
import { useT } from '../../lib/i18n';
import { memberRoute } from '../../lib/memberLinks';
import { formatWhen, presenceOf } from '../../lib/memberPresence';
import { loadFollowingCache, loadMemberCardsCache, saveFollowingCache } from '../../lib/socialCache';
import { formatPlaytime, type LibraryGame } from '../../types/library';
import type { FollowedUser, MemberCardDto } from '../../types/social';
import { MemberAvatar, MemberSection } from './MemberProfileParts';

/** SQLite `datetime('now')` values are UTC without a zone marker. */
function sqliteTime(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value + 'Z').getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function ProfileLibraryCard({ games }: { games: LibraryGame[] }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const installed = games.filter((g) => g.installStatus === 'installed').length;
  const playtime = games.reduce((acc, g) => acc + (g.totalPlaytimeSeconds ?? 0), 0);
  const mostPlayed = games.reduce<LibraryGame | null>(
    (best, g) => ((g.totalPlaytimeSeconds ?? 0) > (best?.totalPlaytimeSeconds ?? 0) ? g : best),
    null,
  );

  return (
    <MemberSection title={t('profile.library.section')}>
      <div className="profile-side-body">
        <dl className="member-info-list">
          <div className="member-info-row">
            <dt>{t('profile.library.games')}</dt>
            <dd>{games.length.toLocaleString(locale)}</dd>
          </div>
          <div className="member-info-row">
            <dt>{t('profile.library.installed')}</dt>
            <dd>{installed.toLocaleString(locale)}</dd>
          </div>
          <div className="member-info-row">
            <dt>{t('profile.library.playtime')}</dt>
            <dd>{playtime > 0 ? formatPlaytime(playtime) : '—'}</dd>
          </div>
        </dl>
        {mostPlayed && (mostPlayed.totalPlaytimeSeconds ?? 0) > 0 && (
          <button
            type="button"
            className="profile-most-played"
            onClick={() => navigate(`/library/game/${mostPlayed.threadId}`)}
          >
            <span className="profile-most-played-label">{t('profile.library.mostPlayed')}</span>
            <span className="profile-most-played-title">{mostPlayed.title}</span>
          </button>
        )}
        <button type="button" className="profile-side-link" onClick={() => navigate('/library')}>
          {t('profile.library.viewAll')}
        </button>
      </div>
    </MemberSection>
  );
}

export function ProfileRecentlyPlayed({ games, now }: { games: LibraryGame[]; now: number }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const recent = useMemo(
    () =>
      games
        .map((g) => ({ game: g, playedAt: sqliteTime(g.lastPlayedAt) }))
        .filter((e): e is { game: LibraryGame; playedAt: number } => e.playedAt !== null)
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, 4),
    [games],
  );

  return (
    <MemberSection title={t('profile.recent.title')}>
      {recent.length === 0 ? (
        <div className="profile-side-empty">{t('profile.recent.empty')}</div>
      ) : (
        <ul className="profile-recent-list">
          {recent.map(({ game, playedAt }) => (
            <li key={game.threadId}>
              <button
                type="button"
                className="profile-recent-row"
                onClick={() => navigate(`/library/game/${game.threadId}`)}
              >
                <span className="profile-recent-thumb">
                  {game.thumbnailUrl && <img src={game.thumbnailUrl} alt="" loading="lazy" />}
                </span>
                <span className="profile-recent-body">
                  <span className="profile-recent-title">{game.title}</span>
                  <span className="profile-recent-meta">
                    {formatWhen(playedAt, locale, now)}
                    {(game.totalPlaytimeSeconds ?? 0) > 0 && ` · ${formatPlaytime(game.totalPlaytimeSeconds)}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </MemberSection>
  );
}

/**
 * Followed members from the Friends page cache (online first). Fetches the
 * list only when it was never loaded, and never fetches member cards.
 */
export function ProfileFriendsPreview({ ownerId, offline, now }: { ownerId: string; offline: boolean; now: number }) {
  const { t } = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<{ users: FollowedUser[]; cards: Record<string, MemberCardDto> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cached, cardCache] = await Promise.all([
        loadFollowingCache(ownerId).catch(() => null),
        loadMemberCardsCache(ownerId).catch(() => ({})),
      ]);
      let users = cached?.data ?? null;
      if (!users && !offline) {
        users = await ipc.getFollowing().catch(() => null);
        if (users) saveFollowingCache(ownerId, users).catch(() => {});
      }
      const cards: Record<string, MemberCardDto> = {};
      for (const [id, entry] of Object.entries(cardCache)) cards[id] = entry.data;
      if (!cancelled) setData({ users: users ?? [], cards });
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, offline]);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data.users].sort(
      (a, b) => (data.cards[b.userId]?.lastSeenTs ?? 0) - (data.cards[a.userId]?.lastSeenTs ?? 0),
    );
  }, [data]);

  if (!data) return null;
  const online = sorted.filter((u) => presenceOf(data.cards[u.userId]?.lastSeenTs, now) === 'online').length;

  return (
    <MemberSection title={t('friends.title')}>
      <div className="profile-side-body">
        {sorted.length === 0 ? (
          <div className="profile-side-empty">{t('friends.empty.title')}</div>
        ) : (
          <>
            <div className="profile-friends-summary">
              {t('friends.subtitle', { count: sorted.length })}
              {online > 0 && (
                <span className="friends-subtitle-online">
                  {' · '}
                  {t('friends.onlineCount', { count: online })}
                </span>
              )}
            </div>
            <div className="member-follow-grid">
              {sorted.slice(0, 12).map((u) => {
                const isOnline = presenceOf(data.cards[u.userId]?.lastSeenTs, now) === 'online';
                return (
                  <button
                    key={u.userId}
                    type="button"
                    className={`member-follow-item${isOnline ? ' member-follow-item--online' : ''}`}
                    title={u.username}
                    onClick={() => navigate(memberRoute(u.userId))}
                  >
                    <MemberAvatar
                      src={data.cards[u.userId]?.avatarUrl ?? u.avatarUrl}
                      username={u.username}
                      className="member-follow-avatar"
                    />
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button type="button" className="profile-side-link" onClick={() => navigate('/friends')}>
          {t('profile.friends.viewAll')}
        </button>
      </div>
    </MemberSection>
  );
}
