import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../../contexts/Offline';
import { useMemberAbout, useMemberPostings, useMemberProfile, type TabState } from '../../../hooks/useMemberProfile';
import { useNow } from '../../../hooks/useNow';
import { buildFriendsMenu } from '../../../lib/contextMenus/buildFriendsMenu';
import { dialog } from '../../../lib/dialog';
import { notifyFollowChange } from '../../../lib/friends';
import { useT } from '../../../lib/i18n';
import { formatIpcError } from '../../../lib/ipcError';
import { memberRoute } from '../../../lib/memberLinks';
import type { MemberAboutDto, MemberFollowList, MemberProfileDto } from '../../../types/social';
import { formatCount } from '../../store/GameCard';
import { Icon } from '../../ui/Icon';
import { useBp, useBpProfile } from '../BpContext';
import { BpAvatar } from '../BpChrome';
import { BpEmpty, BpHeading, BpLoader, BpSubTabs } from '../BpParts';
import { BpFacts, BpReadingBlock, changelogOf, type Fact } from './BpGameParts';
import { BpProfile } from './BpProfile';
import { BpActivityFeed, BpMemberHero, MessageIcon } from './BpSocialParts';

type FriendTab = 'activity' | 'postings' | 'about';

/** Moving along the sub-tabs only loads the one the focus stops on. */
const TAB_SETTLE_MS = 350;

/** Any F95 member's profile; your own account opens the profile screen. */
export function BpFriend({ userId, active }: { userId: string; active: boolean }) {
  const own = useBpProfile().userId;
  if (own && own === userId) return <BpProfile />;
  return <MemberView userId={userId} active={active} />;
}

function MemberView({ userId, active }: { userId: string; active: boolean }) {
  const { t, locale } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();
  const now = useNow();
  const { state, reload, setFollowing } = useMemberProfile(userId);
  const [tab, setTab] = useState<FriendTab>('activity');
  const [settledTab, setSettledTab] = useState<FriendTab>(tab);
  const postings = useMemberPostings(userId, settledTab === 'postings' && !isOffline);
  const about = useMemberAbout(userId, settledTab === 'about' && !isOffline);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledTab(tab), TAB_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [tab]);

  const member = state.kind === 'ready' ? state.member : null;
  const art = member?.coverUrl ?? member?.avatarUrl ?? null;
  useEffect(() => {
    if (active && art) bp.setBackdrop(art);
  }, [bp, active, art]);

  const back = (
    <button type="button" className="bp-btn bp-focusable" onClick={bp.back}>
      {t('bp.hint.back')}
    </button>
  );

  if (!member) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        {isOffline ? (
          <BpEmpty
            icon="alert"
            title={t('offline.title')}
            text={t('offline.hint')}
            action={
              <button type="button" className="bp-btn bp-focusable" data-bp-autofocus="" onClick={bp.back}>
                {t('bp.hint.back')}
              </button>
            }
          />
        ) : state.kind === 'error' ? (
          <BpEmpty
            icon="alert"
            title={t('profile.loadFailed')}
            text={state.message}
            action={
              <div className="bp-actions">
                <button
                  type="button"
                  className="bp-btn bp-btn--primary bp-focusable"
                  data-bp-autofocus=""
                  onClick={() => void reload()}
                >
                  {t('bp.store.retry')}
                </button>
                {back}
              </div>
            }
          />
        ) : (
          <BpLoader label={t('common.loading')} />
        )}
      </div>
    );
  }

  const following = member.followState === 'following';

  async function toggleFollow(current: MemberProfileDto) {
    const unfollowing = current.followState === 'following';
    if (unfollowing) {
      const ok = await dialog.confirm(t('friends.unfollow.confirm', { name: current.username }), {
        kind: 'warning',
        confirmLabel: t('friends.unfollow.action'),
      });
      if (!ok) return;
    }
    setFollowBusy(true);
    try {
      await setFollowing(!unfollowing);
      notifyFollowChange();
    } catch (err) {
      await dialog.alert(t('profile.follow.failed', { error: formatIpcError(err) }), { kind: 'error' });
    } finally {
      setFollowBusy(false);
    }
  }

  function openOptions(current: MemberProfileDto) {
    bp.openSheet({
      title: current.username,
      subtitle: current.customTitle,
      art: current.coverUrl ?? current.avatarUrl,
      items: buildFriendsMenu(
        {
          userId: current.userId,
          username: current.username,
          avatarUrl: current.avatarUrl,
          profileUrl: current.profileUrl,
          customTitle: current.customTitle,
          location: current.location,
          isStaff: current.isStaff,
          isModerator: current.isModerator,
          messagesCount: current.messagesCount,
          reactionScore: current.reactionScore,
          points: current.points,
        },
        {
          isOffline,
          t,
          onUnfollow: current.followState === 'following' ? () => void toggleFollow(current) : undefined,
        },
      ),
    });
  }

  const stats = [
    { label: t('profile.field.messages'), value: member.messagesCount },
    { label: t('profile.field.reactions'), value: member.reactionScore },
    { label: t('profile.field.points'), value: member.points ?? member.trophyPoints },
    { label: t('profile.field.ratings'), value: member.ratingsReceived },
  ].filter((s): s is { label: string; value: number } => s.value != null);

  const tabs: { id: FriendTab; label: string }[] = [
    { id: 'activity', label: t('profile.tab.activity') },
    { id: 'postings', label: t('profile.tab.postings') },
    { id: 'about', label: t('profile.tab.about') },
  ];

  return (
    <div className="bp-screen-body bp-profile" data-bp-scroll-y="">
      <BpMemberHero member={member} now={now}>
        <div className="bp-actions" data-bp-group={`friend-actions-${userId}`} data-bp-row="">
          {member.followState && (
            <button
              type="button"
              className={`bp-btn${following ? '' : ' bp-btn--primary'} bp-focusable`}
              data-bp-autofocus=""
              data-bp-a={following ? t('friends.unfollow.action') : t('profile.follow')}
              disabled={followBusy || isOffline}
              onClick={() => void toggleFollow(member)}
            >
              <Icon name={following ? 'check' : 'plus'} size={20} />
              {following ? t('profile.following') : t('profile.follow')}
            </button>
          )}
          {member.conversationUrl && (
            <button
              type="button"
              className="bp-btn bp-focusable"
              disabled={isOffline}
              onClick={() => void openUrl(member.conversationUrl!)}
            >
              <MessageIcon size={20} />
              {t('profile.sendMessage')}
            </button>
          )}
          <button
            type="button"
            className="bp-btn bp-focusable"
            disabled={isOffline}
            onClick={() => void openUrl(member.profileUrl)}
          >
            <Icon name="external" size={20} />
            {t('profile.openOnF95')}
          </button>
          <button
            type="button"
            className="bp-btn bp-btn--icon bp-focusable"
            aria-label={t('bp.hint.options')}
            title={t('bp.hint.options')}
            data-bp-a={t('bp.hint.options')}
            onClick={() => openOptions(member)}
          >
            <Icon name="more" size={24} strokeWidth={3} />
          </button>
        </div>
      </BpMemberHero>

      {stats.length > 0 && (
        <dl className="bp-stats bp-stats--row">
          {stats.map((s) => (
            <div key={s.label} className="bp-stat">
              <dt>{s.label}</dt>
              <dd>{s.value.toLocaleString(locale)}</dd>
            </div>
          ))}
        </dl>
      )}

      <BpSubTabs id={`friend-tabs-${userId}`} tabs={tabs} active={tab} onChange={setTab} />

      <div className="bp-panel" key={tab}>
        {tab === 'activity' &&
          (member.activity.length > 0 ? (
            <BpActivityFeed items={member.activity} now={now} />
          ) : (
            <BpEmpty icon="news" title={t('profile.activity.empty')} />
          ))}
        {tab === 'postings' && (
          <TabBody state={postings.state} offline={isOffline} onRetry={() => void postings.reload()}>
            {(items) =>
              items.length > 0 ? (
                <BpActivityFeed items={items} now={now} />
              ) : (
                <BpEmpty icon="news" title={t('profile.activity.empty')} />
              )
            }
          </TabBody>
        )}
        {tab === 'about' && (
          <TabBody state={about.state} offline={isOffline} onRetry={() => void about.reload()}>
            {(data) => <AboutPanel about={data} member={member} />}
          </TabBody>
        )}
      </div>
    </div>
  );
}

/** Loading, failed or loaded, for the tabs that load when opened. */
function TabBody<T>({
  state,
  offline,
  onRetry,
  children,
}: {
  state: TabState<T>;
  offline: boolean;
  onRetry: () => void;
  children: (data: T) => ReactNode;
}) {
  const { t } = useT();
  if (state.kind === 'ready') return <>{children(state.data)}</>;
  if (offline) return <BpEmpty icon="alert" title={t('nav.offline')} text={t('offline.hint')} />;
  if (state.kind === 'error') {
    return (
      <BpEmpty
        icon="alert"
        title={t('profile.tab.loadFailed', { error: state.message })}
        action={
          <button type="button" className="bp-btn bp-focusable" onClick={onRetry}>
            {t('bp.store.retry')}
          </button>
        }
      />
    );
  }
  return (
    <div className="bp-center bp-center--pad">
      <BpLoader label={t('common.loading')} />
    </div>
  );
}

/** Bio to read, profile details, and who they follow and who follows them. */
function AboutPanel({ about, member }: { about: MemberAboutDto; member: MemberProfileDto }) {
  const { t, locale } = useT();
  const bio = useMemo(() => (about.bioHtml ? changelogOf(about.bioHtml, 200) : []), [about.bioHtml]);
  const exact = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : null;

  const facts: Fact[] = [];
  const add = (label: string, value: string | null) => {
    if (value && !facts.some((f) => f.label === label)) facts.push({ label, value });
  };
  for (const field of about.fields) add(field.label, field.value);
  add(t('profile.field.joinedAt'), exact(member.joinedAtTs) ?? member.joinedAt);
  add(t('profile.field.lastSeen'), exact(member.lastSeenTs) ?? member.lastSeen);
  for (const [label, value] of Object.entries(member.extraStats)) add(label, value);

  const base = member.profileUrl.replace(/\/?$/, '/');
  return (
    <div className="bp-overview">
      <div>
        <h3 className="bp-about-title">{t('profile.about.bio')}</h3>
        {bio.length > 0 ? <BpReadingBlock blocks={bio} /> : <p className="bp-muted">{t('profile.about.noBio')}</p>}
      </div>
      <aside className="bp-overview-side">
        <BpFacts facts={facts} />
        <FollowRow
          id={`friend-following-${member.userId}`}
          title={t('profile.about.following')}
          list={about.following}
          moreUrl={`${base}following/`}
        />
        <FollowRow
          id={`friend-followers-${member.userId}`}
          title={t('profile.about.followers')}
          list={about.followers}
          moreUrl={`${base}followers/`}
        />
      </aside>
    </div>
  );
}

/** A row of avatars; each opens that member here, "+N" the full list on F95. */
function FollowRow({ id, title, list, moreUrl }: { id: string; title: string; list: MemberFollowList; moreUrl: string }) {
  const { t } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();
  if (list.total === 0) return null;
  const hidden = list.total - list.users.length;
  return (
    <section>
      <BpHeading title={title} count={list.total} />
      {/* Through the route mapping, so your own avatar opens your profile. */}
      <div className="bp-people" data-bp-group={id} data-bp-row="">
        {list.users.map((u) => (
          <button
            key={u.userId}
            type="button"
            className="bp-person bp-focusable"
            title={u.username}
            data-bp-a={t('friends.viewProfile')}
            onClick={() => bp.gameDeps().navigate(memberRoute(u.userId))}
          >
            <BpAvatar profile={u} size={null} />
            <span className="bp-person-name">{u.username}</span>
          </button>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className="bp-person bp-person--more bp-focusable"
            title={t('profile.about.moreOnF95')}
            data-bp-a={t('profile.about.moreOnF95')}
            disabled={isOffline}
            onClick={() => void openUrl(moreUrl)}
          >
            <span className="bp-avatar bp-avatar--letter">+{formatCount(hidden)}</span>
            <span className="bp-person-name">{t('profile.about.moreOnF95')}</span>
          </button>
        )}
      </div>
    </section>
  );
}
