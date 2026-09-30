import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { F95_BASE } from '../../shared/constants';

const BASE = F95_BASE;

/** Who wrote a post or a review. */
export interface ThreadAuthor {
  userId: string | null;
  name: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  /** Letter of XenForo's default avatar, when the member has no picture. */
  avatarLetter: string | null;
  /** User title under the name ("Member", "Newbie"…); posts only. */
  title: string | null;
  /** Role banners ("Donor", "Respected User"…); posts only. */
  banners: string[];
}

export interface ThreadPost {
  id: string;
  /** Position in the thread (#1 is the OP). */
  number: number | null;
  url: string;
  author: ThreadAuthor;
  /** Written by the member who started the thread. */
  byStarter: boolean;
  postedAt: number | null;
  editedAt: number | null;
  /** Post body, normalized (see normalizeMessageHtml). */
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

/** "A, B and 12 others": the names shown and the total. */
export interface Reactions {
  count: number;
  names: string[];
}

export interface ThreadPostsPage {
  threadId: string;
  page: number;
  totalPages: number;
  posts: ThreadPost[];
}

export interface ThreadReviewsPage {
  threadId: string;
  page: number;
  totalPages: number;
  reviews: ThreadReview[];
}

/** URL of a thread page: `page` 'last' asks F95 for the newest posts. */
export function threadPostsUrl(threadId: string, page: number | 'last'): string {
  if (page === 'last') return `${BASE}/threads/${threadId}/latest`;
  return page > 1 ? `${BASE}/threads/${threadId}/page-${page}` : `${BASE}/threads/${threadId}/`;
}

export function threadReviewsUrl(threadId: string, page: number): string {
  const base = `${BASE}/threads/${threadId}/br-reviews/`;
  return page > 1 ? `${base}page-${page}` : base;
}

/**
 * Posts on one thread page, in thread order. The OP (post #1) is left out:
 * it is the game description, shown elsewhere.
 */
export function parseThreadPosts(html: string, finalUrl: string, threadId: string): ThreadPostsPage {
  const $ = cheerio.load(html);
  const starter = cleanText($('.p-description .username').first().text());
  const posts: ThreadPost[] = [];
  $('article.message--post').each((_, el) => {
    const $post = $(el);
    if ($post.hasClass('is-ignored') || $post.hasClass('message--deleted')) return;
    const id = ($post.attr('data-content') ?? $post.attr('id') ?? '').replace(/\D+/g, '');
    if (!id) return;
    const number = postNumber($, $post);
    if (number === 1) return;
    const body = $post.find('.message-body .bbWrapper').first();
    const author = postAuthor($, $post);
    posts.push({
      id,
      number,
      url: `${BASE}/posts/${id}/`,
      author,
      byStarter: !!starter && author.name === starter,
      postedAt: timeMs($post.find('.message-attribution-main time').first()),
      editedAt: timeMs($post.find('.message-lastEdit time').first()),
      html: body.length ? normalizeMessageHtml($, body) : '',
      reactions: parseReactions($post.find('.reactionsBar-link').first().text()),
    });
  });
  const { page, totalPages } = parsePageNav($, finalUrl);
  return { threadId, page, totalPages, posts };
}

/** One page of the thread's reviews (F95's "Reviews" tab), newest first. */
export function parseThreadReviews(html: string, finalUrl: string, threadId: string): ThreadReviewsPage {
  const $ = cheerio.load(html);
  const reviews: ThreadReview[] = [];
  $('.message--review').each((_, el) => {
    const $review = $(el);
    const id = ($review.attr('data-content') ?? '').replace(/\D+/g, '');
    if (!id) return;
    const body = $review.find('.message-body .bbWrapper').first();
    const likes = $review.find('.likesBar a').first().text() || $review.find('.likesBar').text().replace(/^\s*Likes:\s*/i, '');
    reviews.push({
      id,
      author: reviewAuthor($, $review),
      rating: reviewRating($, $review),
      postedAt: timeMs($review.find('footer time, .message-footer time').first()),
      html: body.length ? normalizeMessageHtml($, body) : '',
      likes: parseReactions(likes),
    });
  });
  const { page, totalPages } = parsePageNav($, finalUrl);
  return { threadId, page, totalPages, reviews };
}

/**
 * The rating under the thread title (F95's star widget), the Reviews tab's
 * count and how many pages of posts the thread has.
 */
export function parseThreadCommunity($: cheerio.CheerioAPI, finalUrl: string): {
  rating: { average: number; votes: number } | null;
  reviewCount: number | null;
  discussionPages: number;
} {
  const select = $('select.br-select[data-initial-rating]').first();
  const average = parseFloat(select.attr('data-initial-rating') ?? '');
  const votes = /([\d.,]+)\s*Votes?/i.exec(select.attr('data-vote-content') ?? '');
  const rating =
    Number.isFinite(average) && average > 0
      ? { average, votes: votes ? toInt(votes[1]) : 0 }
      : null;
  const tab = $('a.tabs-tab[href*="br-reviews"]').first();
  const count = /\(([\d.,]+)\)/.exec(tab.text());
  const reviewCount = tab.length ? (count ? toInt(count[1]) : 0) : null;
  return { rating, reviewCount, discussionPages: parsePageNav($, finalUrl).totalPages };
}

/**
 * A post or review body made safe to show outside F95: ads and scripts out,
 * smilies as their text, lazy images loaded, quotes and spoilers as plain
 * elements, links absolute and opening outside the page.
 */
export function normalizeMessageHtml($: cheerio.CheerioAPI, body: cheerio.Cheerio<Element>): string {
  const clone = body.clone();
  clone.find('script, noscript, style, .samBannerUnit, .samItem, .js-selectToQuoteEnd, .lbContainer-zoomer').remove();

  clone.find('img').each((_, el) => {
    const $img = $(el);
    if (/smilie|smiley|emoji/i.test($img.attr('class') ?? '')) {
      $img.replaceWith(escapeHtml($img.attr('alt') ?? ''));
      return;
    }
    const raw = $img.attr('data-src') ?? $img.attr('src') ?? '';
    if (!raw || raw.startsWith('data:')) {
      $img.remove();
      return;
    }
    $img.attr('src', absoluteUrl(raw));
    for (const attr of ['data-src', 'data-url', 'data-zoom-target', 'class', 'style', 'width', 'height', 'srcset']) {
      $img.removeAttr(attr);
    }
    $img.attr('loading', 'lazy');
  });

  // Media embeds (YouTube…) become links: the page shows no iframes.
  clone.find('iframe').each((_, el) => {
    const src = absoluteUrl($(el).attr('src') ?? '');
    $(el).replaceWith(src ? `<a href="${escapeHtml(src)}">${escapeHtml(src)}</a>` : '');
  });

  clone.find('blockquote.bbCodeBlock--quote').each((_, el) => {
    const $q = $(el);
    const who = cleanText($q.find('.bbCodeBlock-title').first().text());
    const content = $q.find('.bbCodeBlock-expandContent').first().html() ?? $q.find('.bbCodeBlock-content').first().html() ?? '';
    $q.replaceWith(
      `<blockquote class="x-quote">${who ? `<cite>${escapeHtml(who)}</cite>` : ''}${content}</blockquote>`,
    );
  });

  clone.find('.bbCodeSpoiler').each((_, el) => {
    const $s = $(el);
    const title = cleanText($s.find('.bbCodeSpoiler-button-title').first().text()) || 'Spoiler';
    const content = $s.find('.bbCodeSpoiler-content').first().html() ?? '';
    $s.replaceWith(`<details class="x-spoiler"><summary>${escapeHtml(title)}</summary>${content}</details>`);
  });

  clone.find('a[href]').each((_, el) => {
    const $a = $(el);
    $a.attr('href', absoluteUrl($a.attr('href') ?? ''));
    $a.attr('target', '_blank');
    $a.attr('rel', 'noreferrer noopener');
    for (const attr of ['class', 'data-xf-init', 'data-xf-click', 'data-content-selector']) $a.removeAttr(attr);
  });

  return (clone.html() ?? '').trim();
}

/** "A, B and 12 others" (or "… and 1 other person"). */
export function parseReactions(text: string): Reactions {
  const t = cleanText(text);
  if (!t) return { count: 0, names: [] };
  const others = /\s+and\s+([\d.,]+)\s+others?\b/i.exec(t);
  const shown = others ? t.slice(0, others.index) : t;
  const names = shown
    .split(/,\s*|\s+and\s+/)
    .map((n) => n.trim())
    .filter(Boolean);
  return { count: names.length + (others ? toInt(others[1]) : 0), names };
}

function postAuthor($: cheerio.CheerioAPI, $post: cheerio.Cheerio<Element>): ThreadAuthor {
  const link = $post.find('.message-name .username').first();
  const avatar = $post.find('.message-avatar .avatar').first();
  const name = cleanText(link.text()) || $post.attr('data-author') || '?';
  return {
    userId: link.attr('data-user-id') ?? avatar.attr('data-user-id') ?? null,
    name,
    profileUrl: link.attr('href') ? absoluteUrl(link.attr('href')!) : null,
    ...avatarOf($, avatar, name),
    title: cleanText($post.find('.message-userTitle').first().text()) || null,
    banners: $post
      .find('.message-userBanner strong')
      .map((_, b) => cleanText($(b).text()))
      .get()
      .filter(Boolean),
  };
}

function reviewAuthor($: cheerio.CheerioAPI, $review: cheerio.Cheerio<Element>): ThreadAuthor {
  const link = $review.find('.contentRow-header .username').first();
  const avatar = $review.find('.contentRow-figure .avatar').first();
  const name = cleanText(link.text()) || $review.attr('data-author') || '?';
  return {
    userId: link.attr('data-user-id') ?? avatar.attr('data-user-id') ?? null,
    name,
    profileUrl: link.attr('href') ? absoluteUrl(link.attr('href')!) : null,
    ...avatarOf($, avatar, name),
    title: null,
    banners: [],
  };
}

function avatarOf(
  $: cheerio.CheerioAPI,
  avatar: cheerio.Cheerio<Element>,
  name: string,
): { avatarUrl: string | null; avatarLetter: string | null } {
  const src = avatar.find('img').first().attr('src');
  if (src && !src.startsWith('data:')) return { avatarUrl: absoluteUrl(src), avatarLetter: null };
  const letter = cleanText(avatar.find('span').first().text()) || name.charAt(0);
  return { avatarUrl: null, avatarLetter: letter.toUpperCase() };
}

function reviewRating($: cheerio.CheerioAPI, $review: cheerio.Cheerio<Element>): number {
  const stars = $review.find('.ratingStars').first();
  const fromTitle = parseFloat(stars.attr('title') ?? '');
  if (Number.isFinite(fromTitle)) return fromTitle;
  const full = stars.find('.ratingStars-star--full').length;
  const half = stars.find('.ratingStars-star--half').length;
  return full + half / 2;
}

function postNumber($: cheerio.CheerioAPI, $post: cheerio.Cheerio<Element>): number | null {
  let n: number | null = null;
  $post.find('.message-attribution-opposite a').each((_, a) => {
    const m = /^#\s*([\d.,]+)$/.exec(cleanText($(a).text()));
    if (m) n = toInt(m[1]);
  });
  return n;
}

function parsePageNav($: cheerio.CheerioAPI, finalUrl: string): { page: number; totalPages: number } {
  const numbers = $('.pageNav-main .pageNav-page')
    .map((_, el) => toInt(cleanText($(el).text())))
    .get()
    .filter((n) => n > 0);
  const current = toInt(cleanText($('.pageNav-main .pageNav-page--current').first().text()));
  const fromUrl = /\/page-(\d+)/.exec(finalUrl);
  const page = current || (fromUrl ? Number(fromUrl[1]) : 1);
  return { page, totalPages: Math.max(page, ...numbers, 1) };
}

function timeMs($time: cheerio.Cheerio<Element>): number | null {
  const s = Number($time.attr('data-time'));
  if (Number.isFinite(s) && s > 0) return s * 1000;
  const iso = Date.parse($time.attr('datetime') ?? '');
  return Number.isFinite(iso) ? iso : null;
}

function toInt(s: string): number {
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(s: string | null | undefined): string {
  return s ? s.replace(/\s+/g, ' ').trim() : '';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(src: string): string {
  if (!src) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${BASE}${src}`;
  return `${BASE}/${src}`;
}
