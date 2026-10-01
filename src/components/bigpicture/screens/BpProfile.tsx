import { useCallback, useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../../contexts/Offline';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useNow } from '../../../hooks/useNow';
import { parseDbTime } from '../../../lib/dbTime';
import { dialog } from '../../../lib/dialog';
import { useT } from '../../../lib/i18n';
import * as ipc from '../../../lib/ipc';
import { activityRoute } from '../../../lib/memberLinks';
import { formatDay, formatWhen, lastSeenLabel, presenceOf } from '../../../lib/memberPresence';
import { saveProfileCache } from '../../../lib/profileCache';
import * as steamAchievements from '../../../lib/steamAchievements';
import type { OverallAchievementStats, UnlockedAchievementView } from '../../../lib/steamAchievements';
import { formatPlaytime, type LibraryGame } from '../../../types/library';
import type { ProfileDto } from '../../../types';
import { Icon } from '../../ui/Icon';
import { useBp, useBpGames, useBpProfile } from '../BpContext';
import { BpAvatar } from '../BpChrome';
import { BpGameTile, BpHeading, BpShelf } from '../BpParts';

const RECENT_GAMES = 12;
const RECENT_UNLOCKS = 10;
const ACTIVITY = 12;

function playedAt(g: LibraryGame): number {
  return parseDbTime(g.lastPlayedAt)?.getTime() ?? 0;
}

/**
 * The signed-in member: F95 cover, avatar and standing, what they played and
 * unlocked here, and their latest activity on the forum.
 */
export function BpProfile() {
  const { t, locale } = useT();
  const bp = useBp();
  const initial = useBpProfile();
  const games = useBpGames();
  const downloads = useDownloadsByThread();
  const { isOffline } = useOffline();
  const now = useNow();
  const [profile, setProfile] = useState<ProfileDto>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [achStats, setAchStats] = useState<OverallAchievementStats | null>(null);
  const [unlocks, setUnlocks] = useState<UnlockedAchievementView[]>([]);

  useEffect(() => {
    let cancelled = false;
    steamAchievements
      .getOverallStats()
      .then((stats) => {
        if (!cancelled) setAchStats(stats);
      })
      .catch(() => undefined);
    steamAchievements
      .listRecentUnlocks(RECENT_UNLOCKS)
      .then((list) => {
        if (!cancelled) setUnlocks(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const library = useMemo(() => {
    const all = games ?? [];
    return {
      total: all.length,
      installed: all.filter((g) => g.installStatus === 'installed' || g.installStatus === 'update_available').length,
      playtime: all.reduce((sum, g) => sum + g.totalPlaytimeSeconds, 0),
      recent: all
        .filter((g) => g.lastPlayedAt)
        .sort((a, b) => playedAt(b) - playedAt(a))
        .slice(0, RECENT_GAMES),
    };
  }, [games]);

  useEffect(() => {
    const timer = window.setTimeout(() => bp.setBackdrop(library.recent[0]?.thumbnailUrl ?? null), 140);
    return () => window.clearTimeout(timer);
  }, [bp, library.recent]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await ipc.getProfile();
      setProfile(fresh);
      await saveProfileCache(fresh);
    } catch (err) {
      await dialog.alert(t('profile.refreshFailed', { error: err instanceof Error ? err.message : String(err) }), {
        kind: 'error',
      });
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  const presence = presenceOf(profile.lastSeenTs, now);
  const seen = lastSeenLabel(profile.lastSeenTs, t, locale, now);
  const joined = profile.joinedAtTs ? formatDay(profile.joinedAtTs, locale) : profile.joinedAt;
  const stats: { label: string; value: string }[] = [
    { label: t('bp.profile.games'), value: String(library.total) },
    { label: t('bp.profile.installed'), value: String(library.installed) },
    { label: t('bp.profile.playtime'), value: formatPlaytime(library.playtime) },
    ...(achStats && achStats.totalAvailable > 0
      ? [{ label: t('bp.profile.achievements'), value: `${achStats.totalUnlocked}/${achStats.totalAvailable}` }]
      : []),
    ...(profile.messagesCount != null ? [{ label: t('profile.field.messages'), value: profile.messagesCount.toLocaleString(locale) }] : []),
    ...(profile.reactionScore != null ? [{ label: t('profile.field.reactions'), value: profile.reactionScore.toLocaleString(locale) }] : []),
    ...((profile.points ?? profile.trophyPoints) != null
      ? [{ label: t('profile.field.points'), value: (profile.points ?? profile.trophyPoints)!.toLocaleString(locale) }]
      : []),
  ];

  function openActivity(url: string | null) {
    if (!url) return;
    const route = activityRoute(url);
    if (route) bp.gameDeps().navigate(route);
    else void openUrl(url);
  }

  return (
    <div className="bp-screen-body bp-profile" data-bp-scroll-y="">
      <section className="bp-profile-hero" data-bp-snap="top">
        <div
          className={`bp-profile-cover${profile.coverUrl ? '' : ' bp-profile-cover--empty'}`}
          style={
            profile.coverUrl
              ? {
                  backgroundImage: `url("${profile.coverUrl}")`,
                  backgroundPositionY: `${profile.coverPositionY ?? 50}%`,
                }
              : undefined
          }
        />
        <div className="bp-profile-head">
          <span className="bp-profile-avatar">
            <BpAvatar profile={profile} size={132} />
            {presence === 'online' && <span className="bp-profile-online" />}
          </span>
          <div className="bp-profile-id">
            <h1 className="bp-profile-name">{profile.username}</h1>
            <div className="bp-meta">
              {profile.customTitle && <span>{profile.customTitle}</span>}
              {profile.banners.map((b) => (
                <span key={b} className="bp-badge">
                  {b}
                </span>
              ))}
              {joined && <span>{t('bp.profile.joined', { date: joined })}</span>}
              {seen && <span>{seen}</span>}
              {profile.location && <span>{profile.location}</span>}
            </div>
            <div className="bp-actions" data-bp-group="profile-actions" data-bp-row="">
              <button
                type="button"
                className="bp-btn bp-focusable"
                data-bp-autofocus=""
                disabled={refreshing || isOffline}
                onClick={() => void refresh()}
              >
                <Icon name="refresh" size={20} />
                {refreshing ? t('common.loading') : t('common.refresh')}
              </button>
              {profile.profileUrl && (
                <button
                  type="button"
                  className="bp-btn bp-focusable"
                  disabled={isOffline}
                  onClick={() => void openUrl(profile.profileUrl!)}
                >
                  <Icon name="external" size={20} />
                  {t('profile.openOnF95')}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <dl className="bp-stats bp-stats--row">
        {stats.map((s) => (
          <div key={s.label} className="bp-stat">
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>

      {library.recent.length > 0 && (
        <BpShelf id="profile-recent" title={t('bp.profile.recent')}>
          {library.recent.map((g, i) => (
            <BpGameTile
              key={g.threadId}
              game={g}
              group="profile-recent"
              index={i}
              download={downloads.get(g.threadId)}
              sub={formatPlaytime(g.totalPlaytimeSeconds)}
            />
          ))}
        </BpShelf>
      )}

      <div className="bp-profile-columns">
        {unlocks.length > 0 && (
          <section>
            <BpHeading title={t('bp.profile.unlocks')} />
            <div className="bp-ach-list bp-ach-list--single">
              {unlocks.map((u) => (
                <div key={`${u.threadId}-${u.apiName}`} className="bp-ach-item is-unlocked bp-focusable" tabIndex={0}>
                  <img className="bp-ach-icon" src={u.iconUrl} alt="" />
                  <span className="bp-ach-text">
                    <span className="bp-ach-name">{u.displayName}</span>
                    <span className="bp-ach-desc">{u.gameTitle}</span>
                  </span>
                  <span className="bp-ach-meta">{u.unlockTime ? formatWhen(u.unlockTime, locale, now) : ''}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {profile.activity.length > 0 && (
          <section>
            <BpHeading title={t('bp.profile.activity')} />
            <div className="bp-feed">
              {profile.activity.slice(0, ACTIVITY).map((item, i) => (
                <button
                  key={`${item.url ?? item.title}-${i}`}
                  type="button"
                  className="bp-feed-item bp-focusable"
                  data-bp-a={t('bp.hint.open')}
                  onClick={() => openActivity(item.url)}
                >
                  <span className="bp-feed-title">{item.title}</span>
                  {item.snippet && <span className="bp-feed-snippet">{item.snippet}</span>}
                  <span className="bp-feed-meta">
                    {item.meta && <span>{item.meta}</span>}
                    {item.dateTs ? <span>{formatWhen(item.dateTs, locale, now)}</span> : item.date && <span>{item.date}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
