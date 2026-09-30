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

export interface GameDetail {
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
