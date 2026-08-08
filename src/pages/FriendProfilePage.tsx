import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import { useT } from '../lib/i18n';
import type { TFunction } from '../lib/i18n';
import { OfflineGate } from '../components/OfflineGate';
import { GameDetailBackBar } from '../components/game/GameDetailLayout';
import {
  MemberAboutList,
  MemberActivityList,
  MemberHero,
  MemberSection,
  MemberStatsRow,
} from '../components/profile/MemberProfileParts';
import type { MemberProfileDto } from '../types/social';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; member: MemberProfileDto };

/**
 * In-app profile of a followed member (`/friends/:userId`) — fetched live
 * from F95 via `get_member_profile`. Shares the hero/stats/activity/about
 * building blocks with the user's own Profile page.
 */
export function FriendProfilePage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { userId } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const reload = useCallback(async () => {
    if (!userId) return;
    setState({ kind: 'loading' });
    try {
      const member = await ipc.getMemberProfile(userId);
      setState({ kind: 'ready', member });
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: string }).message)
            : String(err),
      });
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <OfflineGate>
      <div style={pageStyle}>
        <GameDetailBackBar
          onBack={() => navigate('/friends')}
          breadcrumbTo="/friends"
          breadcrumbLabel={t('nav.friends')}
        />

        <div style={contentStyle}>
          {state.kind === 'loading' && (
            <div className="member-profile-skeleton">
              <div className="skeleton member-profile-skeleton-hero" />
              <div className="skeleton member-profile-skeleton-block" />
            </div>
          )}

          {state.kind === 'error' && (
            <div style={errorBox}>
              <div>{t('profile.loadFailed')}</div>
              <div style={errorDetail}>{state.message}</div>
              <button type="button" style={retryBtn} onClick={() => void reload()}>
                {t('common.refresh')}
              </button>
            </div>
          )}

          {state.kind === 'ready' && (
            <>
              <MemberHero
                avatarUrl={state.member.avatarUrl}
                username={state.member.username}
                userBanner={state.member.userBanner}
                customTitle={state.member.customTitle}
                joinedAt={state.member.joinedAt}
                lastSeen={state.member.lastSeen}
                actions={
                  <button
                    type="button"
                    style={openBtn}
                    onClick={() => void openUrl(state.member.profileUrl)}
                  >
                    {t('profile.openOnF95')}
                  </button>
                }
              />

              <MemberStatsRow
                stats={[
                  { label: t('profile.field.messages'), value: state.member.messagesCount },
                  { label: t('profile.field.reactions'), value: state.member.reactionScore },
                  { label: t('profile.field.points'), value: state.member.points },
                  { label: t('profile.field.trophies'), value: state.member.trophyPoints },
                  { label: t('profile.field.ratings'), value: state.member.ratingsReceived },
                ]}
              />

              <MemberSection title={t('profile.tab.activity')}>
                <MemberActivityList items={state.member.activity} />
              </MemberSection>

              <MemberSection title={t('profile.section.about')}>
                <MemberAboutList rows={aboutRows(state.member, t)} />
              </MemberSection>
            </>
          )}
        </div>
      </div>
    </OfflineGate>
  );
}

function aboutRows(m: MemberProfileDto, t: TFunction): [string, string][] {
  const rows: [string, string][] = [];
  rows.push([t('profile.field.userId'), `#${m.userId}`]);
  if (m.joinedAt) rows.push([t('profile.field.joinedAt'), m.joinedAt]);
  if (m.lastSeen) rows.push([t('profile.field.lastSeen'), m.lastSeen]);
  if (m.userBanner) rows.push([t('profile.field.title'), m.userBanner]);
  for (const [k, v] of Object.entries(m.extraStats)) {
    rows.push([k, v]);
  }
  rows.push([t('profile.field.profileUrl'), m.profileUrl]);
  return rows;
}

const pageStyle: React.CSSProperties = {
  padding: '20px 24px 40px',
};

const contentStyle: React.CSSProperties = {
  maxWidth: 980,
  margin: '16px auto 0',
};

const errorBox: React.CSSProperties = {
  background: 'var(--status-danger-bg)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--status-danger-text)',
  padding: '16px 18px',
  borderRadius: 6,
  fontSize: 13,
};

const errorDetail: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  opacity: 0.85,
  wordBreak: 'break-word',
};

const retryBtn: React.CSSProperties = {
  marginTop: 12,
  background: 'transparent',
  color: 'var(--status-danger-text)',
  border: '1px solid currentColor',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const openBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  padding: '6px 14px',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
