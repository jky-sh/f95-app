import type { ActivityItem, MemberHeaderFields } from '../types';

export interface FollowedUser {
  userId: string;
  username: string;
  avatarUrl: string | null;
  profileUrl: string;
  customTitle: string | null;
  location: string | null;
  isStaff: boolean;
  isModerator: boolean;
  messagesCount: number | null;
  reactionScore: number | null;
  points: number | null;
}

/**
 * Public profile of an arbitrary member — mirrors the sidecar's
 * `getMemberProfile` result (own `ProfileDto` minus the navbar badges).
 */
export interface MemberProfileDto extends MemberHeaderFields {
  userId: string;
  username: string;
  profileUrl: string;
  activity: ActivityItem[];
}

/** "Latest activity" feed or "Postings" tab of a member. */
export type MemberActivityKind = 'latest' | 'postings';

/** Member tooltip data: last seen, banners and stats for the friends list. */
export interface MemberCardDto extends Omit<MemberHeaderFields, 'conversationUrl'> {
  userId: string;
  username: string | null;
}

export interface MiniMember {
  userId: string;
  username: string;
  avatarUrl: string | null;
}

export interface MemberFollowList {
  users: MiniMember[];
  /** Everyone on the list, including those beyond the avatars shown. */
  total: number;
}

/** A member's About tab. HTML fields are raw F95 markup (sanitize before rendering). */
export interface MemberAboutDto {
  bioHtml: string | null;
  fields: Array<{ label: string; value: string }>;
  signatureHtml: string | null;
  following: MemberFollowList;
  followers: MemberFollowList;
}
