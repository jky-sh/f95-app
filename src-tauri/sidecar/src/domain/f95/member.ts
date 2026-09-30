import * as cheerio from 'cheerio';
import {
  absoluteUrl,
  cleanText,
  findAvatarSrc,
  findAvatarSrc2x,
  memberIdFromHref,
  parseCount,
  timeMs,
} from './html';

/**
 * Parsers for member-centric F95 (XenForo 2) markup: the member page header,
 * the member tooltip, following-list rows, activity tabs and the About tab.
 * Header, tooltip and list rows share one summary parser because XF renders
 * the same building blocks (avatar, banners, userTitle, dl.pairs, follow
 * button) in all of them.
 */

export interface ActivityItem {
  avatarUrl: string | null;
  title: string;
  snippet: string | null;
  date: string | null;
  /** Epoch ms of the entry (`<time data-time>`), for relative dates. */
  dateTs: number | null;
  url: string | null;
  /** Secondary label, e.g. the forum a posting was made in. */
  meta: string | null;
}

export type FollowState = 'following' | 'not_following';

export interface MemberSummary {
  avatarUrl: string | null;
  coverUrl: string | null;
  /** `background-position-y` of the cover, in percent. */
  coverPositionY: number | null;
  /** Role banners ("Staff member", "Moderator", "Donor"…). */
  banners: string[];
  /** First banner, for callers that show a single badge. */
  userBanner: string | null;
  /** Rank or custom user title ("Active Member", custom text…). */
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
  trophyPoints: number | null;
  points: number | null;
  ratingsReceived: number | null;
  extraStats: Record<string, string>;
  /** null when there is no follow button (own profile). */
  followState: FollowState | null;
}

export interface MemberHeaderInfo extends MemberSummary {
  /** "Start conversation" link, when the member accepts conversations from us. */
  conversationUrl: string | null;
}

/** Compact member data from `/members/<id>/tooltip` (friends list status). */
export interface MemberCardDto extends MemberSummary {
  userId: string;
  username: string | null;
}

export interface MiniMember {
  userId: string;
  username: string;
  avatarUrl: string | null;
}

export interface MemberAboutDto {
  bioHtml: string | null;
  fields: Array<{ label: string; value: string }>;
  signatureHtml: string | null;
  following: { users: MiniMember[]; total: number };
  followers: { users: MiniMember[]; total: number };
}

const LABELS = {
  messages: ['messages', 'mensagens'],
  reactionScore: ['reaction score', 'pontos de reação'],
  points: ['points', 'pontos'],
  trophyPoints: ['trophy points', 'troféus', 'trofeus'],
  ratingsReceived: ['ratings received', 'ratings', 'avaliações recebidas'],
  joined: ['joined', 'inscrito em'],
  lastSeen: ['last seen', 'visto pela última vez', 'última visita'],
} as const;

const KNOWN_LABELS = new Set<string>(Object.values(LABELS).flat());

interface Pair {
  label: string;
  /** `<dt title>` — F95 labels trophy points "Points" with title "Trophy points". */
  alias: string;
  text: string;
  ts: number | null;
}

function collectPairs($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>): Pair[] {
  const out: Pair[] = [];
  $root.find('dl.pairs').each((_, el) => {
    const $dl = $(el);
    const $dd = $dl.children('dd').first();
    const label = cleanText($dl.children('dt').first().text());
    const text = cleanText($dd.text());
    if (!label || !text) return;
    out.push({
      label,
      alias: cleanText($dl.children('dt').first().attr('title')),
      text,
      ts: timeMs($dd.find('time').first()),
    });
  });
  return out;
}

function findPair(pairs: Pair[], labels: readonly string[]): Pair | undefined {
  return pairs.find(
    (p) => labels.includes(p.label.toLowerCase()) || labels.includes(p.alias.toLowerCase()),
  );
}

function isKnownPair(p: Pair): boolean {
  return KNOWN_LABELS.has(p.label.toLowerCase()) || KNOWN_LABELS.has(p.alias.toLowerCase());
}

/** "A moment ago · Viewing member profile X" → "A moment ago". */
function stripActivityNoise(s: string | null | undefined): string | null {
  if (!s) return null;
  const idx = s.indexOf(' · ');
  return (idx >= 0 ? s.slice(0, idx) : s).trim() || null;
}

function isLikelyImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url);
}

function parseFollowState(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<any>,
): FollowState | null {
  const $btn = $root.find('a[href$="/follow"]').first();
  if ($btn.length === 0) return null;
  const text = cleanText($btn.find('.button-text').text() || $btn.text());
  const unfollow = cleanText($btn.attr('data-sk-unfollow'));
  const follow = cleanText($btn.attr('data-sk-follow'));
  if (unfollow && text === unfollow) return 'following';
  if (follow && text === follow) return 'not_following';
  return /unfollow/i.test(text) ? 'following' : 'not_following';
}

/** Member summary inside `$root` (header, tooltip or list row). */
export function parseMemberSummary(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<any>,
): MemberSummary {
  // Header avatars link to the original-size image; list/tooltip avatars
  // link to the profile, so fall back to the <img> (its 2x srcset if any).
  const $avatarLink = $root.find('a.avatar').first();
  const href = $avatarLink.attr('href');
  const avatarUrl =
    href && isLikelyImageUrl(href)
      ? absoluteUrl(href)
      : findAvatarSrc2x($, ($avatarLink.length ? $avatarLink : $root).find('img').first());

  const $cover = $root.is('.cover-hasImage') ? $root : $root.find('.cover-hasImage').first();
  const coverStyle = $cover.attr('style') ?? '';
  const coverSrc = coverStyle.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i)?.[2];
  const coverPos = coverStyle.match(/background-position-y:\s*([\d.]+)%/i)?.[1];

  const banners: string[] = [];
  $root.find('.userBanner').each((_, el) => {
    const text = cleanText($(el).text());
    if (text && !banners.includes(text)) banners.push(text);
  });

  const pairs = collectPairs($, $root);
  const count = (labels: readonly string[]) => {
    const p = findPair(pairs, labels);
    return p ? parseCount(p.text) : null;
  };
  const joined = findPair(pairs, LABELS.joined);
  const lastSeen = findPair(pairs, LABELS.lastSeen);

  const extraStats: Record<string, string> = {};
  for (const p of pairs) {
    if (!isKnownPair(p)) extraStats[p.label] = p.text;
  }

  return {
    avatarUrl,
    coverUrl: coverSrc ? absoluteUrl(coverSrc) : null,
    coverPositionY: coverPos ? Number(coverPos) : null,
    banners,
    userBanner: banners[0] ?? null,
    customTitle: cleanText($root.find('.userTitle').first().text()) || null,
    location: cleanText($root.find('a[href*="location-info"]').first().text()) || null,
    isStaff: $root.find('.username--staff').length > 0,
    isModerator: $root.find('.username--moderator').length > 0,
    joinedAt: stripActivityNoise(joined?.text),
    joinedAtTs: joined?.ts ?? null,
    lastSeen: stripActivityNoise(lastSeen?.text),
    lastSeenTs: lastSeen?.ts ?? null,
    messagesCount: count(LABELS.messages),
    reactionScore: count(LABELS.reactionScore),
    trophyPoints: count(LABELS.trophyPoints),
    points: count(LABELS.points),
    ratingsReceived: count(LABELS.ratingsReceived),
    extraStats,
    followState: parseFollowState($, $root),
  };
}

/** Header of a member page (`/members/<id>/`). */
export function parseMemberHeader(html: string): MemberHeaderInfo {
  const $ = cheerio.load(html);
  const $header = $('.memberHeader').first();
  const conversationHref = $header.find('a[href*="/conversations/add"]').first().attr('href');
  return {
    ...parseMemberSummary($, $header),
    conversationUrl: conversationHref ? absoluteUrl(conversationHref) : null,
  };
}

export function parseMemberUsername(html: string): string | null {
  const $ = cheerio.load(html);
  const name =
    cleanText($('.memberHeader-name .username').first().text()) ||
    cleanText($('.memberHeader-name').first().text());
  return name || null;
}

/** Content of a member tooltip (`html.content` of its JSON response). */
export function parseMemberCard(html: string, userId: string): MemberCardDto {
  const $ = cheerio.load(html);
  const $root = $('.memberTooltip').first();
  return {
    userId,
    username: cleanText($root.find('.memberTooltip-name').first().text()) || null,
    ...parseMemberSummary($, $root),
  };
}

/**
 * Rows of the "Latest activity" and "Postings" tabs. Both render one
 * `.contentRow` per entry; skip rows nested in another row (quotes).
 */
export function parseActivityRows(html: string): ActivityItem[] {
  const $ = cheerio.load(html);
  const items: ActivityItem[] = [];
  for (const el of $('.contentRow').toArray()) {
    if ($(el).parents('.contentRow').length > 0) continue;
    const $el = $(el);

    const titleEl = $el.find('.contentRow-title').first();
    // Thread ratings render inside the title ("4.20 star(s) 13 Votes").
    const title = cleanText(titleEl.clone().find('.ratingStarsRow, .ratingStars').remove().end().text());
    if (!title) continue;

    const snippet =
      cleanText($el.find('.contentRow-snippet').first().text()) ||
      cleanText($el.find('blockquote').first().text()) ||
      null;

    const dateEl = $el.find('.contentRow-minor time').first();
    const date =
      cleanText(dateEl.attr('data-date-string') ?? '') ||
      cleanText(dateEl.attr('title') ?? '') ||
      cleanText(dateEl.text()) ||
      cleanText($el.find('.contentRow-minor').first().text()) ||
      null;

    const href = titleEl.find('a').last().attr('href') ?? null;

    items.push({
      avatarUrl: findAvatarSrc($, $el.find('.contentRow-figure img').first()),
      title,
      snippet,
      date,
      dateTs: timeMs(dateEl),
      url: href ? absoluteUrl(href) : null,
      meta: cleanText($el.find('.contentRow-minor a[href*="/forums/"]').first().text()) || null,
    });
  }
  return items;
}

function parseAvatarHeap($: cheerio.CheerioAPI, $heap: cheerio.Cheerio<any>): MiniMember[] {
  const users: MiniMember[] = [];
  $heap.find('li a.avatar').each((_, el) => {
    const $a = $(el);
    const userId = $a.attr('data-user-id') ?? memberIdFromHref($a.attr('href') ?? '');
    if (!userId || users.some((u) => u.userId === userId)) return;
    const $img = $a.find('img').first();
    // Members without a photo get a letter avatar (no <img>), so the name
    // comes from the profile slug instead.
    users.push({
      userId,
      username: cleanText($img.attr('alt')) || usernameFromHref($a.attr('href') ?? '') || `#${userId}`,
      avatarUrl: $img.length ? findAvatarSrc2x($, $img) : null,
    });
  });
  return users;
}

/** Best-effort display name from a `/members/<slug>.<id>/` link. */
export function usernameFromHref(href: string): string {
  const m = href.match(/\/members\/([^/]+?)\.\d+\/?/);
  return m ? m[1].replace(/-/g, ' ') : '';
}

/** Rewrites relative links/images in a BB-code fragment and returns its HTML. */
function absolutizeHtml($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string | null {
  $el.find('.lbContainer-zoomer').remove();
  $el.find('img[data-src]').each((_, img) => {
    const $img = $(img);
    if (!$img.attr('src')) $img.attr('src', $img.attr('data-src') ?? '');
  });
  for (const attr of ['href', 'src']) {
    $el.find(`[${attr}]`).each((_, node) => {
      const value = $(node).attr(attr) ?? '';
      if (value && !/^(https?:|mailto:|data:|#)/i.test(value)) {
        $(node).attr(attr, absoluteUrl(value));
      }
    });
  }
  return $el.html()?.trim() || null;
}

/** About tab (`/members/<id>/about`): bio, custom fields, signature, follows. */
export function parseMemberAbout(html: string): MemberAboutDto {
  const $ = cheerio.load(html);
  const $content = $('.p-body-pageContent').first();
  const $scope: cheerio.Cheerio<any> = $content.length ? $content : $.root();
  const about: MemberAboutDto = {
    bioHtml: null,
    fields: [],
    signatureHtml: null,
    following: { users: [], total: 0 },
    followers: { users: [], total: 0 },
  };
  const heaps: Array<{ header: string; href: string; users: MiniMember[]; total: number }> = [];

  $scope.find('.block-row').each((_, el) => {
    const $row = $(el);
    if ($row.parents('.block-row').length > 0) return;
    const header = cleanText($row.children('.block-textHeader').first().text());

    const $heap = $row.find('.listHeap').first();
    if ($heap.length) {
      const users = parseAvatarHeap($, $heap);
      const $more = $row.find('a[href*="/following"], a[href*="/followers"]').first();
      const more = $more.length ? (parseCount($more.text()) ?? 0) : 0;
      heaps.push({ header, href: $more.attr('href') ?? '', users, total: users.length + more });
      return;
    }

    const $bb = $row.find('.bbWrapper').first();
    if (/signature/i.test(header)) {
      if ($bb.length) about.signatureHtml = absolutizeHtml($, $bb);
      return;
    }
    // Trophies and any other titled section are out of scope.
    if (header) return;
    if ($bb.length) {
      about.bioHtml ??= absolutizeHtml($, $bb);
      return;
    }
    $row.find('dl.pairs').each((_i, dl) => {
      const label = cleanText($(dl).children('dt').first().text());
      const value = cleanText($(dl).children('dd').first().text());
      if (label && value) about.fields.push({ label, value });
    });
  });

  // XF lists "Following" before "Followers"; the "…and N more" link names
  // the list when present, the header text otherwise.
  heaps.forEach((heap, i) => {
    const kind = /\/followers/.test(heap.href)
      ? 'followers'
      : /\/following/.test(heap.href)
        ? 'following'
        : /follower/i.test(heap.header)
          ? 'followers'
          : /following/i.test(heap.header) || i === 0
            ? 'following'
            : 'followers';
    about[kind] = { users: heap.users, total: heap.total };
  });
  return about;
}
