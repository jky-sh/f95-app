import { listen } from '@tauri-apps/api/event';
import { getDevDebugSettings, isDevDebugPanelAvailable } from './devDebugSettings';

export type DevLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DevLogEntry {
  id: number;
  tag: string;
  message: string;
  ts: string;
  level: DevLogLevel;
}

const MAX_LINES = 800;
const KNOWN_TAGS = [
  'download',
  'unmask',
  'uploadhaven',
  'buzzheavier',
  'datanodes',
  'workupload',
  'mixdrop',
  'sidecar',
  'mega',
  'gofile',
  'gdrive',
  'vikingfile',
  'akirabox',
] as const;

let nextId = 1;
const entries: DevLogEntry[] = [];
const listeners = new Set<(rows: DevLogEntry[]) => void>();
let subscribed = false;

function push(entry: DevLogEntry) {
  entries.push(entry);
  if (entries.length > MAX_LINES) {
    entries.splice(0, entries.length - MAX_LINES);
  }
  for (const fn of listeners) fn([...entries]);
}

export function isDevDebugEnabled(): boolean {
  return isDevDebugPanelAvailable() && getDevDebugSettings().panelEnabled;
}

export function knownDevLogTags(): readonly string[] {
  return KNOWN_TAGS;
}

export function subscribeDevLogs(fn: (rows: DevLogEntry[]) => void): () => void {
  listeners.add(fn);
  fn([...entries]);
  if (!subscribed && isDevDebugPanelAvailable()) {
    subscribed = true;
    void listen<{
      tag: string;
      message: string;
      ts: string;
      level?: string;
    }>('dev:log', (e) => {
      const level = parseLevel(e.payload.level);
      push({
        id: nextId++,
        tag: e.payload.tag,
        message: e.payload.message,
        ts: e.payload.ts,
        level,
      });
    });
  }
  return () => listeners.delete(fn);
}

function parseLevel(raw: string | undefined): DevLogLevel {
  switch (raw) {
    case 'debug':
    case 'warn':
    case 'error':
      return raw;
    default:
      return 'info';
  }
}

export function clearDevLogs() {
  entries.length = 0;
  for (const fn of listeners) fn([]);
}

export function devLogStats(rows: DevLogEntry[]): {
  total: number;
  byLevel: Record<DevLogLevel, number>;
  byTag: Record<string, number>;
} {
  const byLevel: Record<DevLogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  const byTag: Record<string, number> = {};
  for (const r of rows) {
    byLevel[r.level]++;
    byTag[r.tag] = (byTag[r.tag] ?? 0) + 1;
  }
  return { total: rows.length, byLevel, byTag };
}
