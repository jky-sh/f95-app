/**
 * Theme orchestration.
 *
 * Themes are CSS variable bundles defined in `styles/theme.css`. The work
 * here is just picking which one is active (via `<html data-theme="...">`)
 * and persisting that choice across launches.
 *
 * Logo assets are imported through Vite so they get the production hash
 * treatment; `applyTheme` pushes the right one into the `--logo-src` CSS var.
 */
import * as settings from './settings';
import logoLight from '../assets/lockups/refined-wordmark-light.png';
import logoDark from '../assets/lockups/refined-wordmark-dark.png';
import logoSolid from '../assets/lockups/refined-wordmark-solid.png';

export const KEY_THEME = 'theme';
export const KEY_SKIN = 'skin';

export type ThemeId = 'default' | 'dark' | 'light' | 'red' | 'steam';

/**
 * Skins are a second, independent axis: they restyle the app's *structure*
 * (shapes, gradients, typography) while colors keep coming from the active
 * theme's CSS variables. `steam-skin.css` holds the actual rules, scoped
 * under `html[data-skin='steam']`.
 */
export type SkinId = 'default' | 'steam';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** Tiny representative colors for the picker preview swatch. */
  preview: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'default',
    label: 'Padrão',
    description: 'Escuro com accent vermelho — o visual original.',
    preview: { bg: '#141414', surface: '#1a1a1a', accent: '#e0444c', text: '#dcdcdc' },
  },
  {
    id: 'dark',
    label: 'Escuro (OLED)',
    description: 'Preto profundo + accent azul. Bom em monitor OLED.',
    preview: { bg: '#050505', surface: '#0e0e0e', accent: '#2196f3', text: '#e0e0e0' },
  },
  {
    id: 'light',
    label: 'Claro',
    description: 'Fundo branco, texto escuro. Pro daytime.',
    preview: { bg: '#f5f5f5', surface: '#ffffff', accent: '#c2453a', text: '#1a1a1a' },
  },
  {
    id: 'red',
    label: 'Vermelho F95',
    description: 'Banhado em vermelho com texto creme.',
    preview: { bg: '#1f0a0a', surface: '#2a1010', accent: '#ff6b6b', text: '#fff5ed' },
  },
  {
    id: 'steam',
    label: 'Steam',
    description: 'Azul-marinho clássico da Steam com accent azul-claro.',
    preview: { bg: '#171a21', surface: '#1b2838', accent: '#66c0f4', text: '#c7d5e0' },
  },
];

export interface SkinMeta {
  id: SkinId;
  label: string;
  description: string;
}

export const SKINS: SkinMeta[] = [
  {
    id: 'default',
    label: 'Padrão',
    description: 'A estrutura visual original do app.',
  },
  {
    id: 'steam',
    label: 'Steam',
    description:
      'Visual e layout do cliente da Steam: menu no topo, biblioteca com lista lateral, cantos retos e gradientes. Usa as cores do tema selecionado.',
  },
];

const DEFAULT_THEME: ThemeId = 'default';
const DEFAULT_SKIN: SkinId = 'default';

/** Which lockup variant to display in the sidebar for each theme. */
const THEME_LOGO: Record<ThemeId, string> = {
  default: logoDark, // light wordmark on the original dark surface
  dark: logoDark,    // same wordmark on deeper black
  light: logoLight,    // dark wordmark on bright surface
  red: logoSolid,     // all-red wordmark blends into the red palette
  steam: logoDark,   // light wordmark on the dark navy surface
};

/**
 * Apply a theme by setting `data-theme` on the document element AND pushing
 * the matching lockup URL into the `--logo-src` CSS var. No-op for unknown ids.
 */
export function applyTheme(id: ThemeId): void {
  if (!THEMES.some((t) => t.id === id)) return;
  document.documentElement.setAttribute('data-theme', id);
  document.documentElement.style.setProperty(
    '--logo-src',
    `url(${JSON.stringify(THEME_LOGO[id])})`,
  );
}

/** URL of the lockup asset for a given theme. Used outside CSS (e.g. <img>). */
export function logoFor(id: ThemeId): string {
  return THEME_LOGO[id];
}

/** Read the persisted theme from `app_settings`, or fall back to default. */
export async function loadSavedTheme(): Promise<ThemeId> {
  try {
    const raw = await settings.get(KEY_THEME);
    if (raw && THEMES.some((t) => t.id === raw)) {
      return raw as ThemeId;
    }
  } catch (err) {
    // Migration v4 may not have run yet on a first launch.
    console.warn('[theme] failed to load saved theme', err);
  }
  return DEFAULT_THEME;
}

/** Persist + apply in one step. Used by the Settings UI. */
export async function setTheme(id: ThemeId): Promise<void> {
  applyTheme(id);
  try {
    await settings.set(KEY_THEME, id);
  } catch (err) {
    console.warn('[theme] failed to persist', err);
  }
}

/** Read the currently active theme from `data-theme`. */
export function currentTheme(): ThemeId {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr && THEMES.some((t) => t.id === attr)) {
    return attr as ThemeId;
  }
  return DEFAULT_THEME;
}

/* ------------------------------------------------------------------------- */
/* Skin (structural style) — same persistence/apply mechanics as themes.     */
/* ------------------------------------------------------------------------- */

/**
 * Fired on `window` whenever the skin changes. Components that render
 * different layouts per skin (AppShell top nav, Steam library sidebar)
 * subscribe through `hooks/useSkin`.
 */
export const SKIN_CHANGE_EVENT = 'f95:skin-changed';

/** Apply a skin by setting `data-skin` on the document element. */
export function applySkin(id: SkinId): void {
  if (!SKINS.some((s) => s.id === id)) return;
  document.documentElement.setAttribute('data-skin', id);
  window.dispatchEvent(new CustomEvent(SKIN_CHANGE_EVENT, { detail: id }));
}

/** Read the persisted skin from `app_settings`, or fall back to default. */
export async function loadSavedSkin(): Promise<SkinId> {
  try {
    const raw = await settings.get(KEY_SKIN);
    if (raw && SKINS.some((s) => s.id === raw)) {
      return raw as SkinId;
    }
  } catch (err) {
    console.warn('[theme] failed to load saved skin', err);
  }
  return DEFAULT_SKIN;
}

/** Persist + apply in one step. Used by the Settings UI. */
export async function setSkin(id: SkinId): Promise<void> {
  applySkin(id);
  try {
    await settings.set(KEY_SKIN, id);
  } catch (err) {
    console.warn('[theme] failed to persist skin', err);
  }
}

/** Read the currently active skin from `data-skin`. */
export function currentSkin(): SkinId {
  const attr = document.documentElement.getAttribute('data-skin');
  if (attr && SKINS.some((s) => s.id === attr)) {
    return attr as SkinId;
  }
  return DEFAULT_SKIN;
}
