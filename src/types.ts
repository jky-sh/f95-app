export interface ActivityItem {
  avatarUrl: string | null;
  title: string;
  snippet: string | null;
  date: string | null;
  /** Epoch ms of the entry, for relative dates. */
  dateTs: number | null;
  url: string | null;
  /** Secondary label, e.g. the forum a posting was made in. */
  meta: string | null;
}

export type FollowState = 'following' | 'not_following';

/** Member page header shared by the own profile and friend profiles. */
export interface MemberHeaderFields {
  avatarUrl: string | null;
  coverUrl: string | null;
  /** `background-position-y` of the cover, in percent. */
  coverPositionY: number | null;
  /** Role banners ("Staff member", "Moderator", "Donor"…). */
  banners: string[];
  /** First banner. */
  userBanner: string | null;
  /** Rank or custom user title. */
  customTitle: string | null;
  location: string | null;
  isStaff: boolean;
  isModerator: boolean;
  joinedAt: string | null;
  joinedAtTs: number | null;
  lastSeen: string | null;
  lastSeenTs: number | null;
  messagesCount: number | null;
  reactionScore: number | null;
  /** F95 labels trophy points "Points", so both fields hold the same value. */
  trophyPoints: number | null;
  points: number | null;
  ratingsReceived: number | null;
  extraStats: Record<string, string>;
  /** null on the own profile (no follow button). */
  followState: FollowState | null;
  conversationUrl: string | null;
}

export interface ProfileDto extends MemberHeaderFields {
  username: string;
  alerts: number;
  conversations: number;
  userId: string | null;
  profileUrl: string | null;
  activity: ActivityItem[];
}

export interface BackendError {
  code: BackendErrorCode;
  message: string;
}

export type BackendErrorCode =
  | 'invalid_credentials'
  | 'two_factor_required'
  | 'cloudflare'
  | 'not_initialized'
  | 'sidecar_timeout'
  | 'sidecar_crash'
  | 'protocol'
  | 'io'
  | 'other';

export function isBackendError(err: unknown): err is BackendError {
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as BackendError).code === 'string' &&
    typeof (err as BackendError).message === 'string'
  );
}
