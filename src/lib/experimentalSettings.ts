import { emit, listen } from '@tauri-apps/api/event';
import {
  clampAllPanelLayouts,
  DEFAULT_PANEL_LAYOUTS,
  parsePanelLayouts,
  type OverlayPanelLayouts,
} from '../components/overlay/overlayPanelLayouts';
import * as settings from './settings';

/** Sent to every window (main, overlay, hint) after a save. */
const CHANGED_EVENT = 'settings:experimental-changed';

export type OverlayDisplayMode = 'fullscreen' | 'compact';

export interface OverlayCompactGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExperimentalFeatures {
  notes: boolean;
  guides: boolean;
  browser: boolean;
  achievements: boolean;
}

export interface ExperimentalSettings {
  overlayEnabled: boolean;
  overlayHotkey: string;
  overlayDisplayMode: OverlayDisplayMode;
  overlayCompactGeom: OverlayCompactGeom;
  overlayBackdropOpacity: number;
  features: ExperimentalFeatures;
  browserHomeUrl: string;
  overlayPanelLayouts: OverlayPanelLayouts;
}

/** Steam reserves Shift+Tab — default avoids that conflict. */
export const DEFAULT_OVERLAY_HOTKEY = 'Ctrl+Shift+O';
export const STEAM_CONFLICT_HOTKEY = 'Shift+Tab';
export const DEFAULT_BROWSER_HOME_URL = 'https://f95zone.to';

export const DEFAULT_COMPACT_GEOM: OverlayCompactGeom = {
  x: 80,
  y: 80,
  w: 720,
  h: 480,
};

const COMPACT_MIN_W = 400;
const COMPACT_MIN_H = 280;
const COMPACT_MARGIN = 24;

const DEFAULT_FEATURES: ExperimentalFeatures = {
  notes: true,
  guides: true,
  browser: true,
  achievements: true,
};

const DEFAULTS: ExperimentalSettings = {
  overlayEnabled: false,
  overlayHotkey: DEFAULT_OVERLAY_HOTKEY,
  overlayDisplayMode: 'fullscreen',
  overlayCompactGeom: DEFAULT_COMPACT_GEOM,
  overlayBackdropOpacity: 0.28,
  features: { ...DEFAULT_FEATURES },
  browserHomeUrl: DEFAULT_BROWSER_HOME_URL,
  overlayPanelLayouts: { ...DEFAULT_PANEL_LAYOUTS },
};

const listeners = new Set<(s: ExperimentalSettings) => void>();
let cached: ExperimentalSettings | null = null;

function parseCompactGeom(raw: string | null): OverlayCompactGeom {
  if (!raw) return { ...DEFAULT_COMPACT_GEOM };
  try {
    const o = JSON.parse(raw) as Partial<OverlayCompactGeom>;
    return clampCompactGeom({
      x: typeof o.x === 'number' ? o.x : DEFAULT_COMPACT_GEOM.x,
      y: typeof o.y === 'number' ? o.y : DEFAULT_COMPACT_GEOM.y,
      w: typeof o.w === 'number' ? o.w : DEFAULT_COMPACT_GEOM.w,
      h: typeof o.h === 'number' ? o.h : DEFAULT_COMPACT_GEOM.h,
    });
  } catch {
    return { ...DEFAULT_COMPACT_GEOM };
  }
}

function parseDisplayMode(raw: string | null): OverlayDisplayMode {
  return raw === 'compact' ? 'compact' : 'fullscreen';
}

function parseFeatures(raw: string | null): ExperimentalFeatures {
  if (!raw) return { ...DEFAULT_FEATURES };
  try {
    const o = JSON.parse(raw) as Partial<ExperimentalFeatures>;
    return {
      notes: o.notes !== false,
      guides: o.guides !== false,
      browser: o.browser !== false,
      achievements: o.achievements !== false,
    };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

function parseOpacity(raw: string | null): number {
  if (!raw) return DEFAULTS.overlayBackdropOpacity;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULTS.overlayBackdropOpacity;
  return Math.min(1, Math.max(0, n));
}

export function clampCompactGeom(
  geom: OverlayCompactGeom | null | undefined,
): OverlayCompactGeom {
  const base = geom ?? DEFAULT_COMPACT_GEOM;
  const safe = {
    x: Number.isFinite(base.x) ? base.x : DEFAULT_COMPACT_GEOM.x,
    y: Number.isFinite(base.y) ? base.y : DEFAULT_COMPACT_GEOM.y,
    w: Number.isFinite(base.w) ? base.w : DEFAULT_COMPACT_GEOM.w,
    h: Number.isFinite(base.h) ? base.h : DEFAULT_COMPACT_GEOM.h,
  };
  if (typeof window === 'undefined') return safe;
  const vw = window.screen?.width ?? 1920;
  const vh = window.screen?.height ?? 1080;
  const maxW = Math.max(COMPACT_MIN_W, vw - COMPACT_MARGIN * 2);
  const maxH = Math.max(COMPACT_MIN_H, vh - COMPACT_MARGIN * 2);
  return {
    x: Math.round(Math.min(Math.max(COMPACT_MARGIN, safe.x), vw - COMPACT_MIN_W - COMPACT_MARGIN)),
    y: Math.round(Math.min(Math.max(COMPACT_MARGIN, safe.y), vh - COMPACT_MIN_H - COMPACT_MARGIN)),
    w: Math.round(Math.min(Math.max(COMPACT_MIN_W, safe.w), maxW)),
    h: Math.round(Math.min(Math.max(COMPACT_MIN_H, safe.h), maxH)),
  };
}

function notify() {
  if (!cached) return;
  for (const fn of listeners) fn(cached);
}

export async function loadExperimentalSettings(): Promise<ExperimentalSettings> {
  const [
    overlayEnabled,
    overlayHotkey,
    displayModeRaw,
    geomRaw,
    opacityRaw,
    featuresRaw,
    browserHomeUrl,
    panelLayoutsRaw,
  ] = await Promise.all([
    settings.getBool(settings.KEY_EXP_OVERLAY_ENABLED, false),
    settings.get(settings.KEY_EXP_OVERLAY_HOTKEY),
    settings.get(settings.KEY_EXP_OVERLAY_DISPLAY_MODE),
    settings.get(settings.KEY_EXP_OVERLAY_COMPACT_GEOM),
    settings.get(settings.KEY_EXP_OVERLAY_BACKDROP_OPACITY),
    settings.get(settings.KEY_EXP_FEATURES_JSON),
    settings.get(settings.KEY_EXP_BROWSER_HOME_URL),
    settings.get(settings.KEY_EXP_OVERLAY_PANEL_LAYOUTS),
  ]);
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  cached = {
    overlayEnabled,
    overlayHotkey: overlayHotkey?.trim() || DEFAULT_OVERLAY_HOTKEY,
    overlayDisplayMode: parseDisplayMode(displayModeRaw),
    overlayCompactGeom: parseCompactGeom(geomRaw),
    overlayBackdropOpacity: parseOpacity(opacityRaw),
    features: parseFeatures(featuresRaw),
    browserHomeUrl: browserHomeUrl?.trim() || DEFAULT_BROWSER_HOME_URL,
    overlayPanelLayouts: clampAllPanelLayouts(
      parsePanelLayouts(panelLayoutsRaw),
      viewportW,
      viewportH,
    ),
  };
  return cached;
}

export function getExperimentalSettings(): ExperimentalSettings {
  return cached ?? DEFAULTS;
}

export function isOverlayEnabled(): boolean {
  return getExperimentalSettings().overlayEnabled;
}

export function subscribeExperimentalSettings(
  fn: (s: ExperimentalSettings) => void,
): () => void {
  startCrossWindowSync();
  listeners.add(fn);
  fn(getExperimentalSettings());
  return () => listeners.delete(fn);
}

let syncing = false;

/** Reload when another window saves, so the overlay follows Settings live. */
function startCrossWindowSync(): void {
  if (syncing || typeof window === 'undefined') return;
  syncing = true;
  void listen(CHANGED_EVENT, () => {
    void loadExperimentalSettings().then(notify);
  }).catch(() => {
    syncing = false;
  });
}

/**
 * Saves only the settings in `patch`, merged onto what is stored now rather
 * than this window's copy: the main window and the overlay each keep one,
 * and writing every key from a stale copy undid the other window's changes.
 */
export async function saveExperimentalSettings(
  patch: Partial<ExperimentalSettings>,
): Promise<ExperimentalSettings> {
  const current = await loadExperimentalSettings();
  const next: ExperimentalSettings = {
    ...current,
    ...patch,
    features: patch.features ? { ...current.features, ...patch.features } : current.features,
    overlayCompactGeom: patch.overlayCompactGeom
      ? clampCompactGeom({ ...current.overlayCompactGeom, ...patch.overlayCompactGeom })
      : current.overlayCompactGeom,
    overlayPanelLayouts: patch.overlayPanelLayouts
      ? clampAllPanelLayouts(
          { ...current.overlayPanelLayouts, ...patch.overlayPanelLayouts },
          typeof window !== 'undefined' ? window.innerWidth : 1920,
          typeof window !== 'undefined' ? window.innerHeight : 1080,
        )
      : current.overlayPanelLayouts,
  };
  if (next.overlayDisplayMode === 'compact') {
    next.overlayCompactGeom = clampCompactGeom(next.overlayCompactGeom);
  }
  cached = next;
  const writes: Record<keyof ExperimentalSettings, () => Promise<void>> = {
    overlayEnabled: () => settings.setBool(settings.KEY_EXP_OVERLAY_ENABLED, next.overlayEnabled),
    overlayHotkey: () => settings.set(settings.KEY_EXP_OVERLAY_HOTKEY, next.overlayHotkey),
    overlayDisplayMode: () => settings.set(settings.KEY_EXP_OVERLAY_DISPLAY_MODE, next.overlayDisplayMode),
    overlayCompactGeom: () =>
      settings.set(settings.KEY_EXP_OVERLAY_COMPACT_GEOM, JSON.stringify(next.overlayCompactGeom)),
    overlayBackdropOpacity: () =>
      settings.set(settings.KEY_EXP_OVERLAY_BACKDROP_OPACITY, String(next.overlayBackdropOpacity)),
    features: () => settings.set(settings.KEY_EXP_FEATURES_JSON, JSON.stringify(next.features)),
    browserHomeUrl: () => settings.set(settings.KEY_EXP_BROWSER_HOME_URL, next.browserHomeUrl),
    overlayPanelLayouts: () =>
      settings.set(settings.KEY_EXP_OVERLAY_PANEL_LAYOUTS, JSON.stringify(next.overlayPanelLayouts)),
  };
  await Promise.all(
    (Object.keys(patch) as (keyof ExperimentalSettings)[]).filter((k) => k in writes).map((k) => writes[k]()),
  );
  notify();
  void emit(CHANGED_EVENT).catch(() => {});
  return next;
}
