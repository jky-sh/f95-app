import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ProfileDto } from '../types';
import { logout } from '../lib/ipc';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import { clearCredentials } from '../lib/stronghold';
import { useT, type TFunction } from '../lib/i18n';
import { dialog } from '../lib/dialog';
import { formatPlaytime, type LibraryGame } from '../types/library';
import {
  MemberAboutList,
  MemberActivityList,
  MemberHero,
  MemberSection,
  MemberStatsRow,
} from './profile/MemberProfileParts';
import { ProfileAchievements } from './profile/ProfileAchievements';

interface Props {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

interface LibraryStats {
  total: number;
  installed: number;
  playtimeSeconds: number;
  mostPlayed: LibraryGame | null;
}

/**
 * The logged-in user's profile: F95 hero + forum stats (shared building
 * blocks with friend profiles) enriched with local library stats, recent
 * activity and the About sheet.
 */
export function ProfileView({ profile, onLoggedOut: _onLoggedOut }: Props) {
  const { t } = useT();
  const [working, setWorking] = useState(false);
  const [libStats, setLibStats] = useState<LibraryStats | null>(null);

  // Local library aggregates (SQLite) — available even offline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const games = await library.list({});
        if (cancelled) return;
        const playtimeSeconds = games.reduce(
          (acc, g) => acc + (g.totalPlaytimeSeconds ?? 0),
          0,
        );
        const installed = games.filter((g) => g.installStatus === 'installed').length;
        const mostPlayed = games.reduce<LibraryGame | null>(
          (best, g) =>
            (g.totalPlaytimeSeconds ?? 0) > (best?.totalPlaytimeSeconds ?? 0) ? g : best,
          null,
        );
        setLibStats({ total: games.length, installed, playtimeSeconds, mostPlayed });
      } catch (err) {
        console.warn('[profile] library stats failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onLogout() {
    setWorking(true);
    try {
      await logout();
      await clearCredentials();
      await ipc.restartToLogin();
    } catch (err) {
      console.error('[logout] failed', err);
      await dialog.alert(String(err), { kind: 'error' });
    } finally {
      setWorking(false);
    }
  }

  const mostPlayedLabel =
    libStats?.mostPlayed && (libStats.mostPlayed.totalPlaytimeSeconds ?? 0) > 0
      ? libStats.mostPlayed.title
      : '—';

  return (
    <div style={page}>
      <MemberHero
        avatarUrl={profile.avatarUrl}
        username={profile.username}
        userBanner={profile.userBanner}
        customTitle={profile.customTitle}
        joinedAt={profile.joinedAt}
        lastSeen={profile.lastSeen}
        actions={
          <>
            {profile.profileUrl && (
              <button
                type="button"
                style={openBtn}
                onClick={() => void openUrl(profile.profileUrl!)}
              >
                {t('profile.openOnF95')}
              </button>
            )}
            <button onClick={onLogout} disabled={working} style={logoutBtn}>
              {working ? t('settings.account.loggingOut') : t('settings.account.logout')}
            </button>
          </>
        }
      />

      <MemberStatsRow
        stats={[
          { label: t('profile.field.messages'), value: profile.messagesCount },
          { label: t('profile.field.reactions'), value: profile.reactionScore },
          { label: t('profile.field.points'), value: profile.points },
          { label: t('profile.field.trophies'), value: profile.trophyPoints },
          { label: t('profile.field.ratings'), value: profile.ratingsReceived },
        ]}
      />

      {libStats && libStats.total > 0 && (
        <MemberSection title={t('profile.library.section')}>
          <div style={sectionPad}>
            <MemberStatsRow
              stats={[
                { label: t('profile.library.games'), value: libStats.total },
                { label: t('profile.library.installed'), value: libStats.installed },
                {
                  label: t('profile.library.playtime'),
                  value:
                    libStats.playtimeSeconds > 0
                      ? formatPlaytime(libStats.playtimeSeconds)
                      : '—',
                },
                { label: t('profile.library.mostPlayed'), value: mostPlayedLabel },
              ]}
            />
          </div>
        </MemberSection>
      )}

      <ProfileAchievements />

      <MemberSection title={t('profile.tab.activity')}>
        <MemberActivityList items={profile.activity} />
      </MemberSection>

      <MemberSection title={t('profile.section.about')}>
        <MemberAboutList rows={aboutRows(profile, t)} />
      </MemberSection>
    </div>
  );
}

function aboutRows(profile: ProfileDto, t: TFunction): [string, string][] {
  const rows: [string, string][] = [];
  if (profile.userId) rows.push([t('profile.field.userId'), `#${profile.userId}`]);
  if (profile.joinedAt) rows.push([t('profile.field.joinedAt'), profile.joinedAt]);
  if (profile.lastSeen) rows.push([t('profile.field.lastSeen'), profile.lastSeen]);
  if (profile.userBanner) rows.push([t('profile.field.title'), profile.userBanner]);
  for (const [k, v] of Object.entries(profile.extraStats)) {
    rows.push([k, v]);
  }
  if (profile.profileUrl) rows.push([t('profile.field.profileUrl'), profile.profileUrl]);
  return rows;
}

// --- styles ---

const page: React.CSSProperties = {
  maxWidth: 980,
  margin: '0 auto',
  padding: '16px 8px 40px',
  color: 'var(--text-secondary)',
};

const sectionPad: React.CSSProperties = {
  padding: '2px 18px 16px',
};

const openBtn: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const logoutBtn: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-strong)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  whiteSpace: 'nowrap',
};
