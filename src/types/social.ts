import type { ActivityItem } from '../types';

export interface FollowedUser {
  userId: string;
  username: string;
  avatarUrl: string | null;
  profileUrl: string;
  customTitle: string | null;
}

/**
 * Public profile of an arbitrary member — mirrors the sidecar's
 * `getMemberProfile` result (own `ProfileDto` minus the navbar badges).
 */
export interface MemberProfileDto {
  userId: string;
  username: string;
  profileUrl: string;
  avatarUrl: string | null;
  userBanner: string | null;
  customTitle: string | null;
  joinedAt: string | null;
  lastSeen: string | null;
  messagesCount: number | null;
  reactionScore: number | null;
  trophyPoints: number | null;
  points: number | null;
  ratingsReceived: number | null;
  extraStats: Record<string, string>;
  activity: ActivityItem[];
}
