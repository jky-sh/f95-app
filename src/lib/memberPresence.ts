import type { TFunction } from './i18n';

/** XenForo's default "online" window: active within the last 15 minutes. */
const ONLINE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** online: seen in the last 15 min · today: last 24 h · away: older · unknown: hidden/not loaded. */
export type Presence = 'online' | 'today' | 'away' | 'unknown';

export function presenceOf(lastSeenTs: number | null | undefined, now = Date.now()): Presence {
  if (!lastSeenTs) return 'unknown';
  const age = now - lastSeenTs;
  if (age <= ONLINE_MS) return 'online';
  if (age <= DAY_MS) return 'today';
  return 'away';
}

/**
 * "5 minutes ago" / "yesterday" / "12 days ago" for the last 30 days;
 * null beyond that, so callers can show an absolute date instead.
 */
export function formatAgo(ts: number, locale: string, now = Date.now()): string | null {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.round((ts - now) / 60_000);
  // "now" reads better than "this minute".
  if (minutes === 0) return rtf.format(0, 'second');
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  return null;
}

export function formatDay(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Relative time when recent, the date otherwise. */
export function formatWhen(ts: number, locale: string, now = Date.now()): string {
  return formatAgo(ts, locale, now) ?? formatDay(ts, locale);
}

/** "Online now" / "Seen 3 hours ago" / "Seen on Sep 12, 2026"; null when unknown. */
export function lastSeenLabel(
  lastSeenTs: number | null | undefined,
  t: TFunction,
  locale: string,
  now = Date.now(),
): string | null {
  if (!lastSeenTs) return null;
  if (presenceOf(lastSeenTs, now) === 'online') return t('social.presence.online');
  const ago = formatAgo(lastSeenTs, locale, now);
  return ago
    ? t('social.presence.seenAgo', { when: ago })
    : t('social.presence.seenOn', { date: formatDay(lastSeenTs, locale) });
}
