import { memo, type ReactNode } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../../contexts/Offline';
import { buildNewsActivityMenu } from '../../../lib/contextMenus/buildNewsMenu';
import { useT } from '../../../lib/i18n';
import type { FriendEntry } from '../../../lib/friends';
import { activityRoute } from '../../../lib/memberLinks';
import { formatDay, formatWhen, lastSeenLabel, presenceOf } from '../../../lib/memberPresence';
import type { ActivityItem, MemberHeaderFields } from '../../../types';
import { Icon } from '../../ui/Icon';
import { useBp } from '../BpContext';
import { BpAvatar } from '../BpChrome';

/* ------------------------------------------------------------------------- */
/* Member header                                                              */
/* ------------------------------------------------------------------------- */

export type BpMemberHeroData = Pick<
  MemberHeaderFields,
  | 'avatarUrl'
  | 'coverUrl'
  | 'coverPositionY'
  | 'banners'
  | 'customTitle'
  | 'location'
  | 'isStaff'
  | 'isModerator'
  | 'joinedAt'
  | 'joinedAtTs'
  | 'lastSeenTs'
> & { username: string };

/** Staff / Mod pills; F95's own banners say it already when there are any. */
function RoleBadges({ member }: { member: Pick<MemberHeaderFields, 'isStaff' | 'isModerator'> }) {
  const { t } = useT();
  return (
    <>
      {member.isStaff && <span className="bp-badge bp-badge--role">{t('social.role.staff')}</span>}
      {member.isModerator && <span className="bp-badge bp-badge--role">{t('social.role.mod')}</span>}
    </>
  );
}

/**
 * A member's F95 cover across the top, their avatar (a green dot while
 * online), name and standing; `children` are the screen's actions.
 */
export function BpMemberHero({ member, now, children }: { member: BpMemberHeroData; now: number; children?: ReactNode }) {
  const { t, locale } = useT();
  const presence = presenceOf(member.lastSeenTs, now);
  const seen = lastSeenLabel(member.lastSeenTs, t, locale, now);
  const joined = member.joinedAtTs ? formatDay(member.joinedAtTs, locale) : member.joinedAt;
  return (
    <section className="bp-profile-hero" data-bp-snap="top">
      <div
        className={`bp-profile-cover${member.coverUrl ? '' : ' bp-profile-cover--empty'}`}
        style={
          member.coverUrl
            ? {
                backgroundImage: `url("${member.coverUrl}")`,
                backgroundPositionY: `${member.coverPositionY ?? 50}%`,
              }
            : undefined
        }
      />
      <div className="bp-profile-head">
        <span className="bp-profile-avatar">
          <BpAvatar profile={member} size={null} />
          {presence === 'online' && <span className="bp-profile-online" />}
        </span>
        <div className="bp-profile-id">
          <h1 className="bp-profile-name">{member.username}</h1>
          <div className="bp-meta">
            {member.customTitle && <span>{member.customTitle}</span>}
            {member.banners.map((b) => (
              <span key={b} className="bp-badge">
                {b}
              </span>
            ))}
            {member.banners.length === 0 && <RoleBadges member={member} />}
            {joined && <span>{t('bp.profile.joined', { date: joined })}</span>}
            {seen && <span className={presence === 'online' ? 'bp-meta-online' : undefined}>{seen}</span>}
            {member.location && <span>{member.location}</span>}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Forum activity                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Posts, threads and reactions on the forum. A opens a thread on its store
 * page and a member on their profile, anything else in the browser; X
 * offers the link.
 */
export function BpActivityFeed({ items, now }: { items: ActivityItem[]; now: number }) {
  const { t, locale } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();

  function open(url: string | null) {
    if (!url) return;
    const route = activityRoute(url);
    if (route) bp.gameDeps().navigate(route);
    else void openUrl(url);
  }

  return (
    <div className="bp-feed">
      {items.map((item, i) => (
        <button
          key={`${item.url ?? item.title}-${i}`}
          type="button"
          className="bp-feed-item bp-focusable"
          data-bp-a={item.url ? t('bp.hint.open') : undefined}
          data-bp-x={item.url ? t('bp.hint.options') : undefined}
          onClick={() => open(item.url)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!item.url) return;
            bp.openSheet({
              title: item.title,
              subtitle: item.meta,
              art: item.avatarUrl,
              items: buildNewsActivityMenu(item.url, { isOffline, t }),
            });
          }}
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
  );
}

/* ------------------------------------------------------------------------- */
/* Friend tile                                                                */
/* ------------------------------------------------------------------------- */

/** A speech bubble (messages), drawn like the shared icons. */
export function MessageIcon({ size = 12 }: { size?: number }) {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />
    </svg>
  );
}

interface FriendTileProps {
  entry: FriendEntry;
  /** Position, for the staggered entrance. */
  index: number;
  now: number;
  /** Their card is loading (no last seen yet). */
  pending: boolean;
  autoFocus?: boolean;
  onOpen: (entry: FriendEntry) => void;
  onOptions: (entry: FriendEntry) => void;
  onFocusEntry?: (entry: FriendEntry) => void;
}

/** A followed member: cover strip, avatar with presence, last seen and standing. */
export const BpFriendTile = memo(function BpFriendTile({
  entry,
  index,
  now,
  pending,
  autoFocus,
  onOpen,
  onOptions,
  onFocusEntry,
}: FriendTileProps) {
  const { t, locale } = useT();
  const { user, card, presence } = entry;
  const status = lastSeenLabel(card?.lastSeenTs, t, locale, now);
  const title = card?.customTitle ?? user.customTitle;
  const location = card?.location ?? user.location;
  const messages = card?.messagesCount ?? user.messagesCount;
  const reactions = card?.reactionScore ?? user.reactionScore;
  const roles = { isStaff: card?.isStaff ?? user.isStaff, isModerator: card?.isModerator ?? user.isModerator };
  const cover = card?.coverUrl ?? null;
  return (
    <button
      type="button"
      className={`bp-friend bp-friend--${presence} bp-focusable`}
      style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
      data-bp-a={t('friends.viewProfile')}
      data-bp-x={t('bp.hint.options')}
      data-bp-autofocus={autoFocus || undefined}
      onFocus={onFocusEntry ? () => onFocusEntry(entry) : undefined}
      onClick={() => onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOptions(entry);
      }}
    >
      <span
        className={`bp-friend-cover${cover ? '' : ' bp-friend-cover--empty'}`}
        style={
          cover
            ? { backgroundImage: `url("${cover}")`, backgroundPositionY: `${card?.coverPositionY ?? 50}%` }
            : undefined
        }
        aria-hidden
      />
      <span className="bp-friend-head">
        <span className="bp-friend-avatar">
          <BpAvatar profile={{ avatarUrl: card?.avatarUrl ?? user.avatarUrl, username: user.username }} size={null} />
          {presence === 'online' && <span className="bp-friend-dot" />}
        </span>
        <span className="bp-friend-id">
          <span className="bp-friend-name">{user.username}</span>
          {status ? (
            <span className="bp-friend-status">{status}</span>
          ) : (
            pending && <span className="bp-friend-status bp-friend-status--loading" aria-hidden />
          )}
        </span>
      </span>
      {(title || location || roles.isStaff || roles.isModerator) && (
        <span className="bp-friend-sub">
          <RoleBadges member={roles} />
          {title && <span className="bp-friend-text">{title}</span>}
          {location && <span className="bp-friend-text">{location}</span>}
        </span>
      )}
      {(messages != null || reactions != null) && (
        <span className="bp-friend-stats">
          {messages != null && (
            <span title={t('profile.field.messages')}>
              <MessageIcon />
              {messages.toLocaleString(locale)}
            </span>
          )}
          {reactions != null && (
            <span title={t('profile.field.reactions')}>
              <Icon name="heart" size={12} />
              {reactions.toLocaleString(locale)}
            </span>
          )}
        </span>
      )}
    </button>
  );
});
