/**
 * SQLite's `datetime('now')` stores UTC as "YYYY-MM-DD HH:MM:SS" with no
 * zone, which `new Date()` reads as local time (off by the UTC offset).
 * Values that already carry a zone pass through unchanged.
 */
export function parseDbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.trim();
  const zoneless = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const d = new Date(zoneless ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
