const SQLITE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * SQLite's datetime('now') (local notifications' created_at) is UTC but
 * carries no zone, and `new Date` would read it as local time.
 */
function parseDate(input: string): Date {
  return new Date(SQLITE_DATETIME_RE.test(input) ? `${input.replace(' ', 'T')}Z` : input);
}

/** Human-readable relative time for alert/RSS timestamps. */
export function formatRelativeDate(
  input: string | null | undefined,
  locale?: string,
): string | null {
  if (!input) return null;
  const d = parseDate(input);
  if (Number.isNaN(d.getTime())) return input;

  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (abs < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24) return rtf.format(diffH, 'hour');
  const diffD = Math.round(diffH / 24);
  if (Math.abs(diffD) < 7) return rtf.format(diffD, 'day');

  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export type DateGroup = 'today' | 'yesterday' | 'week' | 'older';

export function getDateGroup(input: string | null | undefined): DateGroup {
  if (!input) return 'older';
  const d = parseDate(input);
  if (Number.isNaN(d.getTime())) return 'older';

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const startWeek = new Date(startToday);
  startWeek.setDate(startWeek.getDate() - 7);

  if (d >= startToday) return 'today';
  if (d >= startYesterday) return 'yesterday';
  if (d >= startWeek) return 'week';
  return 'older';
}

const GROUP_ORDER: DateGroup[] = ['today', 'yesterday', 'week', 'older'];

export function sortDateGroups(a: DateGroup, b: DateGroup): number {
  return GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b);
}
