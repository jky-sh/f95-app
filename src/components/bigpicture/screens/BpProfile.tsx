import { useCallback, useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../../contexts/Offline';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useNow } from '../../../hooks/useNow';
import { parseDbTime } from '../../../lib/dbTime';
import { dialog } from '../../../lib/dialog';
import { useT } from '../../../lib/i18n';
import * as ipc from '../../../lib/ipc';
import { formatWhen } from '../../../lib/memberPresence';
import { saveProfileCache } from '../../../lib/profileCache';
import * as steamAchievements from '../../../lib/steamAchievements';
import type { OverallAchievementStats, UnlockedAchievementView } from '../../../lib/steamAchievements';
import { formatPlaytime, type LibraryGame } from '../../../types/library';
import type { ProfileDto } from '../../../types';
import { Icon } from '../../ui/Icon';
import { useBp, useBpGames, useBpProfile } from '../BpContext';
import { BpGameTile, BpHeading, BpShelf } from '../BpParts';
import { BpActivityFeed, BpMemberHero } from './BpSocialParts';

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

  return (
    <div className="bp-screen-body bp-profile" data-bp-scroll-y="">
      <BpMemberHero member={profile} now={now}>
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
      </BpMemberHero>

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
            <BpActivityFeed items={profile.activity.slice(0, ACTIVITY)} now={now} />
          </section>
        )}
      </div>
    </div>
  );
}
