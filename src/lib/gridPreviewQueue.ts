import { convertFileSrc } from '@tauri-apps/api/core';
import { toF95PreviewUrl } from './f95ImageUrl';
import * as ipc from './ipc';

/**
 * grid: F95's 400 px preview (screenshots, description images);
 * cover: the original resized to 720 px (library covers). Both are cached on
 * disk by the backend, so they load at once next time and offline.
 */
export type PreviewVariant = 'grid' | 'cover';

/** Downloads run in the backend; a few at a time keeps a grid filling up quickly. */
const MAX_CONCURRENT = 3;
const DEBOUNCE_MS = 40;

type Job = { key: string; url: string; variant: PreviewVariant; priority: number };
type Waiter = { resolve: (assetUrl: string) => void; reject: (err: unknown) => void };

const assetUrlCache = new Map<string, string>();
const waitersByKey = new Map<string, Waiter[]>();
const inFlight = new Set<string>();

let pending: Job[] = [];
let active = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function enqueue(job: Job) {
  if (assetUrlCache.has(job.key) || inFlight.has(job.key)) return;
  const existing = pending.find((p) => p.key === job.key);
  if (existing) {
    if (job.priority < existing.priority) existing.priority = job.priority;
    return;
  }
  pending.push({ ...job });
}

function sortPending() {
  pending.sort((a, b) => a.priority - b.priority);
}

function resolveWaiters(key: string, assetUrl: string) {
  assetUrlCache.set(key, assetUrl);
  const list = waitersByKey.get(key);
  if (list) {
    for (const w of list) w.resolve(assetUrl);
    waitersByKey.delete(key);
  }
}

async function worker(job: Job) {
  inFlight.add(job.key);
  try {
    const path = await ipc.resolveRemoteImagePreview({ url: job.url, variant: job.variant });
    resolveWaiters(job.key, convertFileSrc(path));
  } catch {
    // The backend already tried the preview and the original; let the
    // webview load the light preview itself.
    resolveWaiters(job.key, toF95PreviewUrl(job.url));
  } finally {
    inFlight.delete(job.key);
    pending = pending.filter((p) => p.key !== job.key);
    active = Math.max(0, active - 1);
    pump();
  }
}

function pump() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    sortPending();
    const job = pending.shift()!;
    if (assetUrlCache.has(job.key)) continue;
    active += 1;
    void worker(job);
  }
}

function schedulePump(urgent: boolean) {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (urgent) {
    debounceTimer = null;
    pump();
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pump();
  }, DEBOUNCE_MS);
}

/** Local asset URL of the cached preview (see `PreviewVariant`). */
export function requestRemotePreview(
  url: string,
  { variant = 'grid', priority = 5 }: { variant?: PreviewVariant; priority?: number } = {},
): Promise<string> {
  const key = `${variant}|${url}`;
  const cached = assetUrlCache.get(key);
  if (cached) return Promise.resolve(cached);

  return new Promise<string>((resolve, reject) => {
    const list = waitersByKey.get(key) ?? [];
    list.push({ resolve, reject });
    waitersByKey.set(key, list);
    enqueue({ key, url, variant, priority });
    schedulePump(priority <= 1);
  });
}

/** Preview ~400px em cache local (grades de screenshots e imagens da descrição). */
export function requestGridPreview(url: string, priority = 5): Promise<string> {
  return requestRemotePreview(url, { variant: 'grid', priority });
}

export function clearGridPreviewCache(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pending = [];
  inFlight.clear();
  assetUrlCache.clear();
  // Waiters of dropped jobs get the light preview instead of hanging forever.
  for (const [key, list] of waitersByKey) {
    const url = key.slice(key.indexOf('|') + 1);
    for (const w of list) w.resolve(toF95PreviewUrl(url));
  }
  waitersByKey.clear();
  active = 0;
}
