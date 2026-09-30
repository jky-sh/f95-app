import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { ProfileDto } from '../types';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import { clearCredentials } from '../lib/stronghold';
import { useT } from '../lib/i18n';
import { dialog } from '../lib/dialog';
import { saveProfileCache } from '../lib/profileCache';
import type { LibraryGame } from '../types/library';
import { useOffline } from '../contexts/Offline';
import { useNow } from '../hooks/useNow';
import { useMemberAbout, useMemberPostings } from '../hooks/useMemberProfile';
import { MemberAboutPanel } from './profile/MemberAboutPanel';
import {
  MemberActivityList,
  MemberHero,
  MemberStatsRow,
  MemberTabBody,
  MemberTabs,
} from './profile/MemberProfileParts';
import { ProfileAchievements } from './profile/ProfileAchievements';
import {
  ProfileFriendsPreview,
  ProfileLibraryCard,
  ProfileRecentlyPlayed,
} from './profile/ProfileSidebar';
import { Spinner } from './ui/Spinner';

interface Props {
  profile: ProfileDto;
  onLoggedOut: () => void;
}

type Tab = 'activity' | 'postings' | 'about';

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/**
 * The logged-in user's profile: the same hero and tabs as member profiles,
 * plus a sidebar with local library stats, recently played games and a
 * friends preview. The profile can be refreshed from F95 in place.
 */
export function ProfileView({ profile: initialProfile, onLoggedOut: _onLoggedOut }: Props) {
  const { t } = useT();
  const now = useNow();
  const { isOffline } = useOffline();
  const [profile, setProfile] = useState(initialProfile);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState<Tab>('activity');
  const [games, setGames] = useState<LibraryGame[]>([]);
  const userId = profile.userId ?? undefined;
  const postings = useMemberPostings(userId, tab === 'postings');
  const about = useMemberAbout(userId, tab === 'about');

  // Local library (SQLite) — available even offline.
  useEffect(() => {
    let cancelled = false;
    library
      .list({})
      .then((list) => {
        if (!cancelled) setGames(list);
      })
      .catch((err) => console.warn('[profile] library stats failed', err));
    return () => {
      cancelled = true;
    };
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    try {
      const fresh = await ipc.getProfile();
      setProfile(fresh);
      await saveProfileCache(fresh);
      if (postings.state.kind === 'ready') void postings.reload();
      if (about.state.kind === 'ready') void about.reload();
    } catch (err) {
      await dialog.alert(t('profile.refreshFailed', { error: formatErr(err) }), { kind: 'error' });
    } finally {
      setRefreshing(false);
    }
  }

  async function onLogout() {
    setWorking(true);
    try {
      await ipc.logout();
      await clearCredentials();
      await ipc.restartToLogin();
    } catch (err) {
      console.error('[logout] failed', err);
      await dialog.alert(String(err), { kind: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="member-page">
      <div className="member-page-content profile-page">
        <MemberHero
          member={profile}
          now={now}
          actions={
            <>
              <button
                type="button"
                className="member-btn"
                onClick={() => void onRefresh()}
                disabled={refreshing || isOffline}
              >
                {refreshing && <Spinner size="sm" />}
                {t('common.refresh')}
              </button>
              {profile.profileUrl && (
                <button type="button" className="member-btn" onClick={() => void openUrl(profile.profileUrl!)}>
                  {t('profile.openOnF95')}
                </button>
              )}
              <button type="button" className="member-btn" onClick={() => void onLogout()} disabled={working}>
                {working ? t('settings.account.loggingOut') : t('settings.account.logout')}
              </button>
            </>
          }
        />

        <MemberStatsRow
          stats={[
            { label: t('profile.field.messages'), value: profile.messagesCount },
            { label: t('profile.field.reactions'), value: profile.reactionScore },
            { label: t('profile.field.points'), value: profile.points ?? profile.trophyPoints },
            { label: t('profile.field.ratings'), value: profile.ratingsReceived },
          ]}
        />

        <div className="profile-layout">
          <div className="profile-main">
            <MemberTabs
              tabs={[
                { id: 'activity' as const, label: t('profile.tab.activity') },
                // Postings/About need the numeric member id from the navbar.
                ...(userId
                  ? [
                      { id: 'postings' as const, label: t('profile.tab.postings') },
                      { id: 'about' as const, label: t('profile.tab.about') },
                    ]
                  : []),
              ]}
              active={tab}
              onChange={setTab}
            >
              {tab === 'activity' && <MemberActivityList items={profile.activity} now={now} />}
              {tab === 'postings' && (
                <MemberTabBody state={postings.state} onRetry={() => void postings.reload()}>
                  {(items) => <MemberActivityList items={items} now={now} />}
                </MemberTabBody>
              )}
              {tab === 'about' && profile.profileUrl && (
                <MemberTabBody state={about.state} onRetry={() => void about.reload()}>
                  {(data) => (
                    <MemberAboutPanel about={data} member={{ ...profile, profileUrl: profile.profileUrl! }} />
                  )}
                </MemberTabBody>
              )}
            </MemberTabs>

            <ProfileAchievements />
          </div>

          <aside className="profile-side">
            <ProfileLibraryCard games={games} />
            <ProfileRecentlyPlayed games={games} now={now} />
            <ProfileFriendsPreview ownerId={profile.userId ?? profile.username} offline={isOffline} now={now} />
          </aside>
        </div>
      </div>
    </div>
  );
}
