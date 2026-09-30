import { useT } from '../../lib/i18n';
import { lastSeenLabel, type Presence } from '../../lib/memberPresence';
import type { FollowedUser, MemberCardDto } from '../../types/social';
import { MemberAvatar, MemberRoleBadges } from '../profile/MemberProfileParts';

interface Props {
  user: FollowedUser;
  /** Tooltip card (last seen, cover); null until loaded. */
  card: MemberCardDto | null;
  loadingCard: boolean;
  presence: Presence;
  now: number;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/** Friends grid tile: cover strip, avatar with presence, status and stats. */
export function FriendCard({ user, card, loadingCard, presence, now, onOpen, onContextMenu }: Props) {
  const { t, locale } = useT();
  const status = lastSeenLabel(card?.lastSeenTs, t, locale, now);
  const title = card?.customTitle ?? user.customTitle;
  const location = card?.location ?? user.location;
  const messages = card?.messagesCount ?? user.messagesCount;
  const reactions = card?.reactionScore ?? user.reactionScore;
  const coverUrl = card?.coverUrl ?? null;

  return (
    <button
      type="button"
      className={`friend-card friend-card--${presence}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      title={t('friends.viewProfile')}
    >
      <span
        className={`friend-card-cover${coverUrl ? '' : ' friend-card-cover--empty'}`}
        style={
          coverUrl
            ? { backgroundImage: `url("${coverUrl}")`, backgroundPositionY: `${card?.coverPositionY ?? 50}%` }
            : undefined
        }
        aria-hidden
      />
      <span className="friend-card-head">
        <span className="friend-card-avatar-wrap">
          <MemberAvatar
            src={card?.avatarUrl ?? user.avatarUrl}
            username={user.username}
            className="friend-card-avatar"
          />
          {presence === 'online' && <span className="presence-dot" />}
        </span>
        <span className="friend-card-id">
          <span className="friend-card-name-row">
            <span className="friend-card-name">{user.username}</span>
            <MemberRoleBadges
              isStaff={card?.isStaff ?? user.isStaff}
              isModerator={card?.isModerator ?? user.isModerator}
            />
          </span>
          {status ? (
            <span className={`friend-card-status friend-card-status--${presence}`}>{status}</span>
          ) : (
            loadingCard && <span className="skeleton friend-card-status-skeleton" aria-hidden />
          )}
        </span>
      </span>
      {(title || location) && (
        <span className="friend-card-sub">
          {title && <span className="friend-card-title">{title}</span>}
          {location && (
            <span className="friend-card-location">
              <PinIcon />
              {location}
            </span>
          )}
        </span>
      )}
      {(messages !== null || reactions !== null) && (
        <span className="friend-card-stats">
          {messages !== null && (
            <span title={t('profile.field.messages')}>
              <MessageIcon />
              {messages.toLocaleString(locale)}
            </span>
          )}
          {reactions !== null && (
            <span title={t('profile.field.reactions')}>
              <HeartIcon />
              {reactions.toLocaleString(locale)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function MessageIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
