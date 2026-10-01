/**
 * Big Picture: a full-screen, controller-friendly layer over the app
 * (`components/bigpicture`). This module holds whether it is open, so the
 * title bar, the quick search, the tray and Settings can open it without
 * plumbing, plus its saved preferences and the window's fullscreen state.
 */
import { useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as settings from './settings';

export const KEY_BP_INTRO = 'bigpicture_intro';
export const KEY_BP_FULLSCREEN = 'bigpicture_fullscreen';
export const KEY_BP_ON_STARTUP = 'bigpicture_on_startup';
export const KEY_BP_SOUNDS = 'bigpicture_sounds';
export const KEY_BP_CONTROLLER_GUIDE = 'bigpicture_controller_guide';
export const KEY_BP_CONTROLLER_CHORD = 'bigpicture_controller_chord';

/* ------------------------------------------------------------------------- */
/* Open / closing state                                                       */
/* ------------------------------------------------------------------------- */

/** closing: the exit animation is playing; the layer unmounts after it. */
export type BigPictureStatus = 'closed' | 'open' | 'closing';

export interface BigPictureState {
  status: BigPictureStatus;
  /** Where the entry started (the button clicked), for the reveal; null = screen center. */
  origin: { x: number; y: number } | null;
}

let state: BigPictureState = { status: 'closed', origin: null };
const listeners = new Set<() => void>();

function setState(next: BigPictureState): void {
  const opening = state.status === 'closed' && next.status !== 'closed';
  state = next;
  if (opening) setBigPictureStage('open');
  if (next.status === 'closed') delete document.documentElement.dataset.bp;
  for (const notify of listeners) notify();
}

/**
 * How the desktop UI behind the layer looks (`html[data-bp]`, styled in
 * big-picture.css): `open` recedes into the dark while the layer grows,
 * `covered` stops painting it once hidden, `leaving` brings it back while
 * the layer shrinks away.
 */
export function setBigPictureStage(stage: 'open' | 'covered' | 'leaving'): void {
  document.documentElement.dataset.bp = stage;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const snapshot = () => state;

export function useBigPictureState(): BigPictureState {
  return useSyncExternalStore(subscribe, snapshot);
}

export function isBigPictureOpen(): boolean {
  return state.status !== 'closed';
}

/** Opens Big Picture; `origin` is the point the reveal grows from. */
export function openBigPicture(origin: { x: number; y: number } | null = null): void {
  // Also while closing: the exit animation finishes first.
  if (state.status !== 'closed') return;
  setState({ status: 'open', origin });
}

/** Opens it from a clicked control, revealing from the control's center. */
export function openBigPictureFrom(el: Element | null): void {
  const rect = el?.getBoundingClientRect();
  openBigPicture(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null);
}

/** Asks the layer to play its exit animation; it calls `finishBigPictureClose` after. */
export function closeBigPicture(): void {
  if (state.status !== 'open') return;
  setState({ ...state, status: 'closing' });
}

export function finishBigPictureClose(): void {
  if (state.status === 'closed') return;
  setState({ status: 'closed', origin: null });
}

/* ------------------------------------------------------------------------- */
/* Preferences                                                                */
/* ------------------------------------------------------------------------- */

export interface BigPicturePrefs {
  /** Play the logo animation on the way in (a short fade otherwise). */
  intro: boolean;
  /** Put the window in fullscreen while Big Picture is open. */
  fullscreen: boolean;
  /** Open Big Picture as soon as the app starts. */
  onStartup: boolean;
  /** Interface sounds (focus ticks, confirm/back, entry and exit themes). */
  sounds: boolean;
  /** A short press of the Xbox button opens Big Picture, also from the tray. */
  controllerGuide: boolean;
  /** Holding View + Menu opens Big Picture, for pads whose Xbox button is taken. */
  controllerChord: boolean;
}

export const DEFAULT_BP_PREFS: BigPicturePrefs = {
  intro: true,
  fullscreen: true,
  onStartup: false,
  sounds: true,
  controllerGuide: true,
  controllerChord: true,
};

let prefs: BigPicturePrefs = DEFAULT_BP_PREFS;
let prefsLoad: Promise<BigPicturePrefs> | null = null;
const prefListeners = new Set<() => void>();

export function loadBigPicturePrefs(): Promise<BigPicturePrefs> {
  if (!prefsLoad) {
    prefsLoad = Promise.all([
      settings.getBool(KEY_BP_INTRO, DEFAULT_BP_PREFS.intro),
      settings.getBool(KEY_BP_FULLSCREEN, DEFAULT_BP_PREFS.fullscreen),
      settings.getBool(KEY_BP_ON_STARTUP, DEFAULT_BP_PREFS.onStartup),
      settings.getBool(KEY_BP_SOUNDS, DEFAULT_BP_PREFS.sounds),
      settings.getBool(KEY_BP_CONTROLLER_GUIDE, DEFAULT_BP_PREFS.controllerGuide),
      settings.getBool(KEY_BP_CONTROLLER_CHORD, DEFAULT_BP_PREFS.controllerChord),
    ])
      .then(([intro, fullscreen, onStartup, sounds, controllerGuide, controllerChord]) => {
        prefs = { intro, fullscreen, onStartup, sounds, controllerGuide, controllerChord };
        for (const notify of prefListeners) notify();
        return prefs;
      })
      .catch((err) => {
        console.warn('[big-picture] failed to load preferences', err);
        prefsLoad = null;
        return prefs;
      });
  }
  return prefsLoad;
}

export async function saveBigPicturePrefs(patch: Partial<BigPicturePrefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  for (const notify of prefListeners) notify();
  const keys: Record<keyof BigPicturePrefs, string> = {
    intro: KEY_BP_INTRO,
    fullscreen: KEY_BP_FULLSCREEN,
    onStartup: KEY_BP_ON_STARTUP,
    sounds: KEY_BP_SOUNDS,
    controllerGuide: KEY_BP_CONTROLLER_GUIDE,
    controllerChord: KEY_BP_CONTROLLER_CHORD,
  };
  try {
    await Promise.all(
      (Object.keys(patch) as (keyof BigPicturePrefs)[]).map((k) => settings.setBool(keys[k], prefs[k])),
    );
  } catch (err) {
    console.warn('[big-picture] failed to save preferences', err);
  }
}

function subscribePrefs(notify: () => void): () => void {
  prefListeners.add(notify);
  void loadBigPicturePrefs();
  return () => prefListeners.delete(notify);
}

const prefsSnapshot = () => prefs;

/** Saved preferences, kept current when either Settings page changes them. */
export function useBigPicturePrefs(): BigPicturePrefs {
  return useSyncExternalStore(subscribePrefs, prefsSnapshot);
}

/** The same outside React: `notify` gets the preferences after every change. */
export function subscribeBigPicturePrefs(notify: (prefs: BigPicturePrefs) => void): () => void {
  return subscribePrefs(() => notify(prefs));
}

/* ------------------------------------------------------------------------- */
/* Fullscreen                                                                 */
/* ------------------------------------------------------------------------- */

/** Whether the window was fullscreen before Big Picture put it there. */
let wasFullscreen: boolean | null = null;
/** Maximized before: WebView2 keeps the maximized size in fullscreen (a black
 *  band the height of the taskbar), so it is restored first and maximized again on the way out. */
let wasMaximized = false;

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export async function isWindowFullscreen(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFullscreen();
  } catch {
    return document.fullscreenElement != null;
  }
}

export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (on) {
      if (await win.isMaximized()) {
        wasMaximized = true;
        await win.unmaximize();
        await nextFrame();
      }
      await win.setFullscreen(true);
    } else {
      await win.setFullscreen(false);
      if (wasMaximized) {
        wasMaximized = false;
        await nextFrame();
        await win.maximize();
      }
    }
  } catch {
    // Browser preview: the page's own fullscreen is the closest thing.
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* not allowed without a gesture */
    }
  }
}

/** Fullscreen for the session, remembering how to put the window back. */
export async function enterBigPictureFullscreen(): Promise<void> {
  const already = await isWindowFullscreen();
  if (wasFullscreen === null) wasFullscreen = already;
  if (!already) await setWindowFullscreen(true);
}

/** Leaves fullscreen unless the window was already fullscreen before. */
export async function leaveBigPictureFullscreen(): Promise<void> {
  const restore = wasFullscreen;
  wasFullscreen = null;
  if (restore === false && (await isWindowFullscreen())) await setWindowFullscreen(false);
}
