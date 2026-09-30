import * as ipc from './ipc';
import type { SamCategory, SamOptionsResult } from '../types/sam';

const options = new Map<SamCategory, Promise<SamOptionsResult>>();

/**
 * Prefix groups and tag catalog of a SAM category, fetched once per session:
 * the catalog bootstrap and the store filters used to ask for the same
 * `games` options on every visit. A failure is dropped so the next call
 * tries again.
 */
export function loadSamOptions(category: SamCategory): Promise<SamOptionsResult> {
  let request = options.get(category);
  if (!request) {
    request = ipc.samOptions(category);
    options.set(category, request);
    request.catch(() => options.delete(category));
  }
  return request;
}
