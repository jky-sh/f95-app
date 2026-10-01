import type { OverlayTab } from './overlayTypes';

export interface OverlayPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
}

export type OverlayPanelLayouts = Record<OverlayTab, OverlayPanelLayout>;

const MIN_W = 280;
const MIN_H = 200;

export const DEFAULT_PANEL_LAYOUTS: OverlayPanelLayouts = {
  // Top right on any screen: clamping pulls the huge x back to the edge.
  game: { x: 99999, y: 48, w: 380, h: 360, open: true },
  notes: { x: 72, y: 48, w: 400, h: 360, open: true },
  guides: { x: 96, y: 420, w: 360, h: 280, open: false },
  browser: { x: 500, y: 72, w: 540, h: 420, open: false },
  achievements: { x: 180, y: 120, w: 460, h: 400, open: false },
};

export function clampPanelLayout(
  layout: OverlayPanelLayout,
  viewportW: number,
  viewportH: number,
): OverlayPanelLayout {
  const margin = 8;
  const dockW = 64;
  const maxW = Math.max(MIN_W, viewportW - margin * 2 - dockW);
  const maxH = Math.max(MIN_H, viewportH - margin * 2);
  const w = Math.round(Math.min(Math.max(MIN_W, layout.w), maxW));
  const h = Math.round(Math.min(Math.max(MIN_H, layout.h), maxH));
  const x = Math.round(Math.min(Math.max(margin + dockW, layout.x), viewportW - w - margin));
  const y = Math.round(Math.min(Math.max(margin, layout.y), viewportH - h - margin));
  return { ...layout, x, y, w, h };
}

export function parsePanelLayouts(raw: string | null): OverlayPanelLayouts {
  const base = { ...DEFAULT_PANEL_LAYOUTS };
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Partial<Record<OverlayTab, Partial<OverlayPanelLayout>>>;
    for (const tab of Object.keys(base) as OverlayTab[]) {
      const p = o[tab];
      if (!p) continue;
      base[tab] = {
        x: typeof p.x === 'number' ? p.x : base[tab].x,
        y: typeof p.y === 'number' ? p.y : base[tab].y,
        w: typeof p.w === 'number' ? p.w : base[tab].w,
        h: typeof p.h === 'number' ? p.h : base[tab].h,
        open: typeof p.open === 'boolean' ? p.open : base[tab].open,
      };
    }
    return base;
  } catch {
    return base;
  }
}

export function clampAllPanelLayouts(
  layouts: OverlayPanelLayouts,
  viewportW: number,
  viewportH: number,
): OverlayPanelLayouts {
  const next = { ...layouts };
  for (const tab of Object.keys(next) as OverlayTab[]) {
    next[tab] = clampPanelLayout(next[tab], viewportW, viewportH);
  }
  return next;
}
