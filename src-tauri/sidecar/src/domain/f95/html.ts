import type * as cheerio from 'cheerio';
import { F95_BASE } from '../../shared/constants';

/** Shared cheerio helpers for F95 (XenForo 2) pages. */

export function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

export function absoluteUrl(src: string): string {
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${F95_BASE}${src}`;
  return `${F95_BASE}/${src}`;
}

export function findAvatarSrc(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<any>,
): string | null {
  if (img.length === 0) return null;
  // XF lazy-loads avatars; the real URL lives in data-src while src may be a
  // 1x1 placeholder. Prefer data-src when present.
  const candidates = [img.attr('data-src'), img.attr('src'), img.attr('data-original')];
  for (const c of candidates) {
    if (c && !isPlaceholder(c)) return absoluteUrl(c);
  }
  // fall back to the first candidate even if it looks like a placeholder
  for (const c of candidates) {
    if (c) return absoluteUrl(c);
  }
  return null;
}

/**
 * The sharper avatar of an `<img>` that also advertises a 2x size in
 * `srcset` (list avatars are 48px "s" with a 96px "m" alternative).
 */
export function findAvatarSrc2x(
  $: cheerio.CheerioAPI,
  img: cheerio.Cheerio<any>,
): string | null {
  const srcset = img.attr('srcset') ?? '';
  const twoX = srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .find(([, density]) => density === '2x');
  if (twoX?.[0] && !isPlaceholder(twoX[0])) return absoluteUrl(twoX[0]);
  return findAvatarSrc($, img);
}

function isPlaceholder(src: string): boolean {
  return (
    src.startsWith('data:image/gif') ||
    src.includes('blank.gif') ||
    src.endsWith('/blank.png')
  );
}

/** Member id from `/members/<slug>.<id>/` or `/members/<id>/` links. */
export function memberIdFromHref(href: string): string | null {
  const m = href.match(/\/members\/(?:[^/]*?\.)?(\d+)\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

/** Epoch milliseconds from an XF `<time data-time="…">` (seconds). */
export function timeMs(time: cheerio.Cheerio<any>): number | null {
  const raw = time.attr('data-time');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** Integer from a stat like "6,917" / "1.080"; null when there are no digits. */
export function parseCount(text: string): number | null {
  const digits = text.replace(/[^\d-]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}
