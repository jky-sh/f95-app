import { isBackendError } from '../types';
import type { TFunction } from './i18n';

/** Extract a readable message from Tauri invoke failures. */
export function formatIpcError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
    if (typeof o.error === 'string' && o.error.trim()) return o.error;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

/** Backend error codes that have a translated, user-facing explanation. */
const EXPLAINED_CODES = new Set([
  'cloudflare',
  'not_initialized',
  'sidecar_timeout',
  'sidecar_crash',
  'io',
  'protocol',
]);

/**
 * What went wrong, in the user's language: F95 failures the user can act on
 * (Cloudflare wall, expired session, timeouts) get a translated sentence,
 * anything else falls back to the raw message.
 */
export function describeIpcError(err: unknown, t: TFunction): string {
  if (isBackendError(err) && EXPLAINED_CODES.has(err.code)) return t(`errors.${err.code}`);
  return formatIpcError(err);
}
