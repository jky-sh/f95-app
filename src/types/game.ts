export interface GamePrefix {
  name: string;
  cssClass: string | null;
}

export interface GameTag {
  slug: string;
  name: string;
}

export interface GameDownload {
  host: string;
  url: string;
  text: string;
  /** Nearest preceding section label (e.g. "Win/Linux", "Collection", "08-10"). */
  group: string | null;
}

export interface SocialLink {
  host: string;
  url: string;
  text: string;
}

export interface GameDetail extends GameCommunitySummary {
  threadId: string;
  threadUrl: string;
  title: string;
  rawTitle: string;
  version: string | null;
  developer: string | null;
  bannerUrl: string | null;
  screenshots: string[];
  descriptionHtml: string;
  /** The OP's changelog, cut out of the description; null when there is none. */
  changelogHtml: string | null;
  prefixes: GamePrefix[];
  fields: Record<string, string>;
  tags: GameTag[];
  downloads: GameDownload[];
  social: SocialLink[];
}

/** F95 thread community data added later: details cached before it lack these. */
export interface GameCommunitySummary {
  /** The stars under the thread title; null when nobody rated it. */
  rating?: { average: number; votes: number } | null;
  /** Count on the thread's Reviews tab; null when it has no such tab. */
  reviewCount?: number | null;
  /** Pages of posts in the thread. */
  discussionPages?: number;
}

/** Who wrote a post or a review. */
export interface ThreadAuthor {
  userId: string | null;
  name: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  /** Letter of F95's default avatar, when the member has no picture. */
  avatarLetter: string | null;
  title: string | null;
  banners: string[];
}

/** "A, B and 12 others": the names shown and the total. */
export interface Reactions {
  count: number;
  names: string[];
}

export interface ThreadPost {
  id: string;
  /** Position in the thread (#1 is the OP, never listed). */
  number: number | null;
  url: string;
  author: ThreadAuthor;
  /** Written by the member who started the thread. */
  byStarter: boolean;
  /** Epoch ms. */
  postedAt: number | null;
  editedAt: number | null;
  /** Sidecar-normalized HTML; sanitize before rendering. */
  html: string;
  reactions: Reactions;
}

export interface ThreadReview {
  id: string;
  author: ThreadAuthor;
  /** 1 to 5 stars. */
  rating: number;
  postedAt: number | null;
  html: string;
  likes: Reactions;
}

export interface ThreadPostsPage {
  threadId: string;
  page: number;
  totalPages: number;
  /** In thread order (oldest first). */
  posts: ThreadPost[];
}

export interface ThreadReviewsPage {
  threadId: string;
  page: number;
  totalPages: number;
  /** Newest first. */
  reviews: ThreadReview[];
}
