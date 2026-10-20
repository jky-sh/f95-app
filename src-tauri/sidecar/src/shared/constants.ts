import { chromiumMajorVersion } from '../infra/playwright/runtime';

/**
 * The User-Agent of the Chromium the sidecar ships. Cloudflare's clearance
 * cookie only holds for the User-Agent of the browser that passed the
 * check, and a version that disagrees with that browser's own client hints
 * gets challenged again.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  `(KHTML, like Gecko) Chrome/${chromiumMajorVersion('148')}.0.0.0 Safari/537.36`;

export const F95_BASE = 'https://f95zone.to';
