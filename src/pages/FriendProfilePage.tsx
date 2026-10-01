import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../lib/i18n';
import { dialog } from '../lib/dialog';
import { OfflineGate } from '../components/OfflineGate';
import { GameDetailBackBar } from '../components/game/GameDetailLayout';
import { MemberAboutPanel } from '../components/profile/MemberAboutPanel';
import {
  MemberActivityList,
  MemberHero,
  MemberStatsRow,
  MemberTabBody,
  MemberTabs,
} from '../components/profile/MemberProfileParts';
import { useMemberAbout, useMemberPostings, useMemberProfile } from '../hooks/useMemberProfile';
import { useNow } from '../hooks/useNow';
import type { MemberProfileDto } from '../types/social';

type Tab = 'activity' | 'postings' | 'about';
const TABS: Tab[] = ['activity', 'postings', 'about'];

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/**
 * In-app profile of any F95 member (`/friends/:userId`): hero with cover,
 * follow and message actions, stats and Activity / Postings / About tabs.
 */
export function FriendProfilePage() {
  const { userId } = useParams();
  // Remount per member so moving between profiles never flashes the last one.
  return <MemberProfileView key={userId} userId={userId} />;
}

function MemberProfileView({ userId }: { userId: string | undefined }) {
  const { t } = useT();
  const navigate = useNavigate();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'activity';
  const { state, reload, setFollowing } = useMemberProfile(userId);
  const postings = useMemberPostings(userId, tab === 'postings');
  const about = useMemberAbout(userId, tab === 'about');
  const [followBusy, setFollowBusy] = useState(false);

  // Came here from another profile (follower avatars): go back to it.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

  function setTab(next: Tab) {
    setParams(next === 'activity' ? {} : { tab: next }, { replace: true });
  }

  async function onToggleFollow(member: MemberProfileDto) {
    const following = member.followState === 'following';
    if (following) {
      const ok = await dialog.confirm(t('friends.unfollow.confirm', { name: member.username }), {
        kind: 'warning',
        confirmLabel: t('friends.unfollow.action'),
      });
      if (!ok) return;
    }
    setFollowBusy(true);
    try {
      await setFollowing(!following);
    } catch (err) {
      await dialog.alert(t('profile.follow.failed', { error: formatErr(err) }), { kind: 'error' });
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <OfflineGate>
      <div className="member-page">
        <GameDetailBackBar
          onBack={() => (canGoBack ? navigate(-1) : navigate('/friends'))}
          breadcrumbTo="/friends"
          breadcrumbLabel={t('nav.friends')}
        />

        <div className="member-page-content">
          {state.kind === 'loading' && (
            <div className="member-profile-skeleton">
              <div className="skeleton member-profile-skeleton-hero" />
              <div className="skeleton member-profile-skeleton-stats" />
              <div className="skeleton member-profile-skeleton-block" />
            </div>
          )}

          {state.kind === 'error' && (
            <div className="member-error">
              <div>{t('profile.loadFailed')}</div>
              <div className="member-error-detail">{state.message}</div>
              <button type="button" className="member-btn" onClick={() => void reload()}>
                {t('common.refresh')}
              </button>
            </div>
          )}

          {state.kind === 'ready' && (
            <>
              <MemberHero
                member={state.member}
                now={now}
                actions={
                  <>
                    {state.member.followState && (
                      <button
                        type="button"
                        className={`member-btn ${
                          state.member.followState === 'following' ? 'member-btn--following' : 'member-btn--primary'
                        }`}
                        disabled={followBusy}
                        title={state.member.followState === 'following' ? t('profile.following.title') : undefined}
                        onClick={() => void onToggleFollow(state.member)}
                      >
                        {state.member.followState === 'following' ? `✓ ${t('profile.following')}` : t('profile.follow')}
                      </button>
                    )}
                    {state.member.conversationUrl && (
                      <button
                        type="button"
                        className="member-btn"
                        onClick={() => void openUrl(state.member.conversationUrl!)}
                      >
                        {t('profile.sendMessage')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="member-btn"
                      onClick={() => void openUrl(state.member.profileUrl)}
                    >
                      {t('profile.openOnF95')}
                    </button>
                  </>
                }
              />

              <MemberStatsRow
                stats={[
                  { label: t('profile.field.messages'), value: state.member.messagesCount },
                  { label: t('profile.field.reactions'), value: state.member.reactionScore },
                  { label: t('profile.field.points'), value: state.member.points ?? state.member.trophyPoints },
                  { label: t('profile.field.ratings'), value: state.member.ratingsReceived },
                ]}
              />

              <MemberTabs
                tabs={[
                  { id: 'activity', label: t('profile.tab.activity') },
                  { id: 'postings', label: t('profile.tab.postings') },
                  { id: 'about', label: t('profile.tab.about') },
                ]}
                active={tab}
                onChange={setTab}
              >
                {tab === 'activity' && <MemberActivityList items={state.member.activity} now={now} />}
                {tab === 'postings' && (
                  <MemberTabBody state={postings.state} onRetry={() => void postings.reload()}>
                    {(items) => <MemberActivityList items={items} now={now} />}
                  </MemberTabBody>
                )}
                {tab === 'about' && (
                  <MemberTabBody state={about.state} onRetry={() => void about.reload()}>
                    {(data) => <MemberAboutPanel about={data} member={state.member} />}
                  </MemberTabBody>
                )}
              </MemberTabs>
            </>
          )}
        </div>
      </div>
    </OfflineGate>
  );
}
