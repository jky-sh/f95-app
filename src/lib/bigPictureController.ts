/**
 * Opens Big Picture with a controller. Rust watches XInput pads in the
 * background (`bp_gamepad.rs`): a short press of the Xbox button, or View +
 * Menu held, brings this window forward and sends `bigpicture:open-request`.
 * Pads XInput doesn't see (a PlayStation pad without Steam Input or
 * DS4Windows) are watched here instead, only while the window has focus.
 */
import { listen } from '@tauri-apps/api/event';
import { setInputMethod } from '../components/bigpicture/bpInput';
import {
  DEFAULT_BP_PREFS,
  isBigPictureOpen,
  loadBigPicturePrefs,
  openBigPicture,
  subscribeBigPicturePrefs,
  type BigPicturePrefs,
} from './bigPicture';
import * as ipc from './ipc';

export const BIGPICTURE_OPEN_REQUEST_EVENT = 'bigpicture:open-request';

/** Standard mapping: View (Create/Share), Menu (Options), Guide (PS/Home). */
const PAD_VIEW = 8;
const PAD_MENU = 9;
const PAD_GUIDE = 16;
/** Same timings as the Rust side. */
const GUIDE_TAP_MAX_MS = 1000;
const CHORD_HOLD_MS = 600;
const POLL_MS = 100;

interface Shortcuts {
  guide: boolean;
  chord: boolean;
}

function openFromController(): void {
  if (isBigPictureOpen()) return;
  // The hint bar shows controller buttons from the first frame.
  setInputMethod('gamepad');
  openBigPicture(null);
}

/** Tauri calls just do nothing in the browser preview. */
async function safely<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch (err) {
    console.warn('[big-picture] controller bridge:', err);
    return undefined;
  }
}

/** Runs in the main window after sign-in; returns the cleanup. */
export function startBigPictureControllerBridge(): () => void {
  let active = true;
  let shortcuts: Shortcuts = {
    guide: DEFAULT_BP_PREFS.controllerGuide,
    chord: DEFAULT_BP_PREFS.controllerChord,
  };
  let synced = '';

  const sync = (p: BigPicturePrefs) => {
    if (!active) return;
    shortcuts = { guide: p.controllerGuide, chord: p.controllerChord };
    const key = `${shortcuts.guide}|${shortcuts.chord}`;
    if (key === synced) return;
    synced = key;
    void safely(() => ipc.bigPictureSyncController(shortcuts.guide, shortcuts.chord));
  };
  void loadBigPicturePrefs().then(sync);
  const unsubscribe = subscribeBigPicturePrefs(sync);

  let unlisten: (() => void) | null = null;
  void safely(() =>
    listen(BIGPICTURE_OPEN_REQUEST_EVENT, () => {
      if (active) openFromController();
    }),
  ).then((fn) => {
    if (!fn) return;
    if (active) unlisten = fn;
    else fn();
  });

  const stopWatching = watchFocusedPads(() => shortcuts);

  return () => {
    active = false;
    unsubscribe();
    unlisten?.();
    stopWatching();
    // Signed out, or the window is going away: Rust stops opening it.
    void safely(() => ipc.bigPictureSyncController(false, false));
  };
}

/* ------------------------------------------------------------------------- */
/* Pads only the webview sees                                                 */
/* ------------------------------------------------------------------------- */

interface PadState {
  guide: boolean;
  guideSince: number | null;
  chordSince: number | null;
  /** Fired for this hold: waits for View or Menu to be let go. */
  chordLatched: boolean;
}

/** What a pad holds when we first look was pressed before: it can't fire. */
function seedPad(guide: boolean, chordButtons: boolean): PadState {
  return { guide, guideSince: null, chordSince: null, chordLatched: chordButtons };
}

/** The Rust state machine again: Guide fires on a short tap's release, the chord after a hold. */
function stepPad(
  s: PadState,
  input: { guide: boolean; chord: boolean; chordButtons: boolean },
  now: number,
  on: Shortcuts,
): boolean {
  let fire = false;
  if (input.guide && !s.guide) s.guideSince = now;
  if (!input.guide && s.guide) {
    if (on.guide && s.guideSince != null && now - s.guideSince < GUIDE_TAP_MAX_MS) fire = true;
    s.guideSince = null;
  }
  s.guide = input.guide;

  if (input.chord) {
    if (s.chordSince == null) s.chordSince = now;
    if (!s.chordLatched && now - s.chordSince >= CHORD_HOLD_MS) {
      s.chordLatched = true;
      if (on.chord) fire = true;
    }
  } else {
    s.chordSince = null;
    if (!input.chordButtons) s.chordLatched = false;
  }
  return fire;
}

/**
 * The PS button (or Guide, where the browser exposes it) tapped, or View +
 * Menu held, while this window has focus and Big Picture is closed. Big
 * Picture reads the pad itself once open.
 */
function watchFocusedPads(current: () => Shortcuts): () => void {
  if (typeof navigator.getGamepads !== 'function') return () => {};
  let timer: ReturnType<typeof setInterval> | null = null;
  const pads = new Map<number, PadState>();
  const connectedPads = (): Gamepad[] => {
    try {
      return navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected);
    } catch {
      return []; // gamepads blocked by the page's permissions
    }
  };

  const stop = () => {
    if (timer != null) clearInterval(timer);
    timer = null;
    pads.clear();
  };

  const tick = () => {
    const connected = connectedPads();
    if (!connected.length) {
      stop();
      return;
    }
    const on = current();
    if ((!on.guide && !on.chord) || !document.hasFocus() || isBigPictureOpen()) {
      // Seeded again when this resumes.
      pads.clear();
      return;
    }
    const now = performance.now();
    for (const pad of connected) {
      const held = (i: number) => pad.buttons[i]?.pressed ?? false;
      const guide = held(PAD_GUIDE);
      const chordButtons = held(PAD_VIEW) && held(PAD_MENU);
      // View + Menu and nothing else: with more held it's a game's own combo.
      const chord =
        chordButtons &&
        pad.buttons.every((b, i) => !b.pressed || i === PAD_VIEW || i === PAD_MENU || i === PAD_GUIDE);
      const state = pads.get(pad.index);
      if (!state) {
        pads.set(pad.index, seedPad(guide, chordButtons));
        continue;
      }
      if (stepPad(state, { guide, chord, chordButtons }, now, on)) {
        openFromController();
        pads.clear();
        return;
      }
    }
  };

  const start = () => {
    if (timer == null) timer = setInterval(tick, POLL_MS);
  };
  window.addEventListener('gamepadconnected', start);
  if (connectedPads().length) start();

  return () => {
    window.removeEventListener('gamepadconnected', start);
    stop();
  };
}
