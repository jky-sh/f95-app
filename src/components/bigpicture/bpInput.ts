/**
 * Big Picture input: keyboard, gamepad and mouse turned into a handful of
 * actions, plus spatial navigation — focus moves to the nearest control in
 * the direction pressed, over whichever layer is on top (a dialog from the
 * rest of the app, a Big Picture panel, or the screen itself).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type BpDirection = 'up' | 'down' | 'left' | 'right';
export type BpAction =
  | BpDirection
  | 'accept'
  | 'back'
  | 'options'
  | 'search'
  | 'menu'
  | 'prevTab'
  | 'nextTab';

export type BpInputMethod = 'keyboard' | 'gamepad' | 'mouse';

/** Controls Big Picture moves focus between. */
export const BP_FOCUSABLE = '.bp-focusable';
/** Controls of the app's own dialogs when one shows over Big Picture. */
const DIALOG_FOCUSABLE =
  'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/* ------------------------------------------------------------------------- */
/* Last input method (drives the button glyphs in the hint bar)              */
/* ------------------------------------------------------------------------- */

let inputMethod: BpInputMethod = 'keyboard';
const methodListeners = new Set<() => void>();

export function setInputMethod(next: BpInputMethod): void {
  if (next === inputMethod) return;
  inputMethod = next;
  for (const notify of methodListeners) notify();
}

export function useInputMethod(): BpInputMethod {
  return useSyncExternalStore(
    (notify) => {
      methodListeners.add(notify);
      return () => methodListeners.delete(notify);
    },
    () => inputMethod,
  );
}

/* ------------------------------------------------------------------------- */
/* Keyboard                                                                   */
/* ------------------------------------------------------------------------- */

export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** The action a key stands for; typing in a field keeps its own keys. */
export function keyAction(e: KeyboardEvent): BpAction | null {
  if (e.altKey || e.metaKey) return null;
  const typing = isTextField(document.activeElement);
  if (e.ctrlKey) return e.key.toLowerCase() === 'k' ? 'search' : null;
  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return typing ? null : 'left';
    case 'ArrowRight':
      return typing ? null : 'right';
    case 'Enter':
      return typing ? null : 'accept';
    case ' ':
      return typing ? null : 'accept';
    case 'Escape':
      return 'back';
    case 'Backspace':
      return typing ? null : 'back';
    case 'PageUp':
      return 'prevTab';
    case 'PageDown':
      return 'nextTab';
    case 'ContextMenu':
      return 'options';
  }
  if (typing || e.shiftKey) return null;
  switch (e.key.toLowerCase()) {
    case 'q':
      return 'prevTab';
    case 'e':
      return 'nextTab';
    case 'x':
      return 'options';
    case 'm':
      return 'menu';
    case '/':
      return 'search';
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Gamepad (standard mapping: Xbox layout)                                    */
/* ------------------------------------------------------------------------- */

const BUTTON_ACTIONS: Partial<Record<number, BpAction>> = {
  0: 'accept', // A
  1: 'back', // B
  2: 'options', // X
  3: 'search', // Y
  4: 'prevTab', // LB
  5: 'nextTab', // RB
  8: 'menu', // View
  9: 'menu', // Menu
  16: 'menu', // Guide, when the browser exposes it
};

const DPAD: Record<number, BpDirection> = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const STICK_DEADZONE = 0.55;
const REPEAT_DELAY_MS = 380;
const REPEAT_MS = 110;
const REPEAT_FAST_MS = 60;
const SCROLL_DEADZONE = 0.15;
/** Pixels per frame at full tilt (about 2,700 px/s at 60 fps); gentle near the center. */
const SCROLL_SPEED = 46;

interface GamepadHandlers {
  onAction: (action: BpAction) => void;
  /** Right stick: scroll by this many pixels (vertical). */
  onScroll: (dy: number) => void;
}

/**
 * Polls connected gamepads while `enabled`. Presses fire once; directions
 * repeat while held, getting faster. Ignored while the window has no focus
 * (a game running in front must not drive the menus behind it). What is
 * already held when polling starts or focus comes back (the buttons that
 * woke Big Picture, a game's input) waits for a release instead of firing.
 */
export function useGamepad(enabled: boolean, handlers: GamepadHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || typeof navigator.getGamepads !== 'function') return;
    let raf = 0;
    const pressed = new Map<number, boolean[]>();
    let heldDir: BpDirection | null = null;
    let nextRepeat = 0;
    let repeats = 0;
    let resync = true;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!document.hasFocus()) {
        resync = true;
        heldDir = null;
        return;
      }
      let dir: BpDirection | null = null;
      let scroll = 0;
      let seeded = false;
      for (const pad of navigator.getGamepads()) {
        if (!pad || !pad.connected) continue;
        const now_ = pad.buttons.map((b) => b.pressed);
        // First look at this pad (it can show up a few frames late), or focus
        // just came back: what it holds now is the starting point, not a press.
        const seen = pressed.get(pad.index);
        const prev = resync || !seen ? now_ : seen;
        if (prev === now_) seeded = true;
        pressed.set(pad.index, now_);
        now_.forEach((isDown, i) => {
          if (!isDown) return;
          const dpad = DPAD[i];
          if (dpad) {
            dir = dpad;
            return;
          }
          const action = BUTTON_ACTIONS[i];
          if (action && !prev[i]) {
            setInputMethod('gamepad');
            handlersRef.current.onAction(action);
          }
        });
        const [lx = 0, ly = 0, , ry = 0] = pad.axes;
        if (!dir) {
          if (Math.abs(lx) > STICK_DEADZONE || Math.abs(ly) > STICK_DEADZONE) {
            dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : ly > 0 ? 'down' : 'up';
          }
        }
        if (Math.abs(ry) > SCROLL_DEADZONE) {
          // Curve past the dead zone: fine control when barely tilted.
          const tilt = (Math.abs(ry) - SCROLL_DEADZONE) / (1 - SCROLL_DEADZONE);
          scroll += Math.sign(ry) * tilt ** 1.7;
        }
      }

      resync = false;
      if (seeded) {
        // A direction held from before doesn't move or repeat until let go.
        heldDir = dir;
        nextRepeat = Infinity;
      } else if (dir !== heldDir) {
        heldDir = dir;
        repeats = 0;
        if (dir) {
          setInputMethod('gamepad');
          handlersRef.current.onAction(dir);
          nextRepeat = now + REPEAT_DELAY_MS;
        }
      } else if (dir && now >= nextRepeat) {
        repeats += 1;
        handlersRef.current.onAction(dir);
        nextRepeat = now + (repeats > 4 ? REPEAT_FAST_MS : REPEAT_MS);
      }
      if (scroll) {
        setInputMethod('gamepad');
        handlersRef.current.onScroll(scroll * SCROLL_SPEED);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}

/* ------------------------------------------------------------------------- */
/* Spatial navigation                                                         */
/* ------------------------------------------------------------------------- */

function isShown(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : true;
}

function isEnabled(el: HTMLElement): boolean {
  return !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';
}

export interface NavScope {
  el: HTMLElement;
  /** A dialog from the rest of the app: plain buttons/links, not `.bp-focusable`. */
  dialog: boolean;
}

/** What directions move through: the topmost dialog or panel, else the screen. */
export function navScope(root: HTMLElement): NavScope {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(
    (d) => !root.contains(d) && isShown(d),
  );
  if (dialogs.length) return { el: dialogs[dialogs.length - 1], dialog: true };
  const layers = root.querySelectorAll<HTMLElement>('[data-bp-layer]');
  if (layers.length) return { el: layers[layers.length - 1], dialog: false };
  return { el: root, dialog: false };
}

export function focusables(scope: NavScope): HTMLElement[] {
  return [...scope.el.querySelectorAll<HTMLElement>(scope.dialog ? DIALOG_FOCUSABLE : BP_FOCUSABLE)].filter(
    (el) => isEnabled(el) && isShown(el),
  );
}

/** The vertical scroller a control lives in (a screen body, a panel). */
export function scrollerOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-bp-scroll-y]');
}

export function canScroll(scroller: HTMLElement, dir: 1 | -1): boolean {
  return dir > 0
    ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2
    : scroller.scrollTop > 2;
}

/**
 * Brings a control into view the way a TV interface scrolls: shelves
 * (`data-bp-snap="row"`) settle at the same height every time, the first
 * section (`data-bp-snap="top"`) takes the page back to its very top, and
 * anything else moves just enough to clear the edges. Inside a shelf the
 * row scrolls sideways on its own.
 */
export function revealElement(el: HTMLElement): void {
  const track = el.closest<HTMLElement>('[data-bp-track]');
  if (track) {
    const tr = track.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const pad = Math.min(tr.width * 0.06, 96);
    if (r.left < tr.left + pad) track.scrollBy({ left: r.left - tr.left - pad, behavior: 'smooth' });
    else if (r.right > tr.right - pad) track.scrollBy({ left: r.right - tr.right + pad, behavior: 'smooth' });
  }
  const scroller = scrollerOf(el);
  if (!scroller) return;
  const sr = scroller.getBoundingClientRect();
  const snap = el.closest<HTMLElement>('[data-bp-snap]');
  if (snap?.dataset.bpSnap === 'top') {
    scroller.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (snap?.dataset.bpSnap === 'row') {
    const top = scroller.scrollTop + snap.getBoundingClientRect().top - sr.top - sr.height * 0.05;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return;
  }
  const r = el.getBoundingClientRect();
  const margin = Math.min(sr.height * 0.1, 96);
  if (r.top < sr.top + margin) {
    scroller.scrollBy({ top: r.top - sr.top - margin, behavior: 'smooth' });
  } else if (r.bottom > sr.bottom - margin) {
    // Taller than the view (a long text): show its top, the D-pad reads on.
    const tall = r.height > sr.height - margin * 2;
    scroller.scrollBy({ top: tall ? r.top - sr.top - margin : r.bottom - sr.bottom + margin, behavior: 'smooth' });
  }
}

/** Focus without the browser's jump, then bring it into view. */
export function focusElement(el: HTMLElement, opts: { scroll?: boolean } = {}): void {
  el.focus({ preventScroll: true });
  if (opts.scroll !== false) revealElement(el);
}

/**
 * Up/down on a control that runs past the view (a long description) scrolls
 * through it before the focus leaves; true when it scrolled.
 */
export function scrollThrough(el: HTMLElement, dir: 'up' | 'down'): boolean {
  const scroller = scrollerOf(el);
  if (!scroller) return false;
  const sr = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const step = sr.height * 0.4;
  if (dir === 'down' && r.bottom > sr.bottom + 4 && canScroll(scroller, 1)) {
    scroller.scrollBy({ top: Math.min(step, r.bottom - sr.bottom + 48), behavior: 'smooth' });
    return true;
  }
  if (dir === 'up' && r.top < sr.top - 4 && canScroll(scroller, -1)) {
    scroller.scrollBy({ top: -Math.min(step, sr.top - r.top + 48), behavior: 'smooth' });
    return true;
  }
  return false;
}

/** Nothing to focus that way: scroll the page a step, if it can go further. */
export function scrollStep(from: HTMLElement | null, root: HTMLElement, dir: 'up' | 'down'): boolean {
  const scroller =
    (from && scrollerOf(from)) ?? root.querySelector<HTMLElement>('.bp-screen:not([hidden]) [data-bp-scroll-y]');
  if (!scroller || !canScroll(scroller, dir === 'down' ? 1 : -1)) return false;
  const step = scroller.clientHeight * 0.4;
  scroller.scrollBy({ top: dir === 'down' ? step : -step, behavior: 'smooth' });
  return true;
}

/** Last focused control per group (shelf, tab row), to come back where you left it. */
const groupMemory = new Map<string, HTMLElement>();

export function rememberGroupFocus(el: HTMLElement): void {
  const group = el.closest<HTMLElement>('[data-bp-group]')?.dataset.bpGroup;
  if (group) groupMemory.set(group, el);
}

export function forgetGroupFocus(): void {
  groupMemory.clear();
}

function groupOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-bp-group]');
}

/** The nearest control from `from` in `dir`, or null at an edge. */
export function findNext(
  from: HTMLElement,
  dir: BpDirection,
  candidates: HTMLElement[],
): HTMLElement | null {
  const f = from.getBoundingClientRect();
  const fcx = f.left + f.width / 2;
  const fcy = f.top + f.height / 2;
  const horizontal = dir === 'left' || dir === 'right';
  // Rows (shelves, chip rows) keep left/right inside themselves.
  const fromGroup = groupOf(from);
  const lockedRow = horizontal && fromGroup?.dataset.bpRow != null ? fromGroup : null;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === from || el.contains(from)) continue;
    if (lockedRow && !lockedRow.contains(el)) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let gap: number;
    let cross: number;
    let offset: number;
    switch (dir) {
      case 'right':
        if (cx <= fcx + 1 || r.right <= f.right - 1) continue;
        gap = Math.max(0, r.left - f.right);
        cross = Math.max(0, r.top - f.bottom, f.top - r.bottom);
        offset = Math.abs(cy - fcy);
        break;
      case 'left':
        if (cx >= fcx - 1 || r.left >= f.left + 1) continue;
        gap = Math.max(0, f.left - r.right);
        cross = Math.max(0, r.top - f.bottom, f.top - r.bottom);
        offset = Math.abs(cy - fcy);
        break;
      case 'down':
        if (cy <= fcy + 1 || r.bottom <= f.bottom - 1) continue;
        gap = Math.max(0, r.top - f.bottom);
        cross = Math.max(0, r.left - f.right, f.left - r.right);
        offset = Math.abs(cx - fcx);
        break;
      case 'up':
      default:
        if (cy >= fcy - 1 || r.top >= f.top + 1) continue;
        gap = Math.max(0, f.top - r.bottom);
        cross = Math.max(0, r.left - f.right, f.left - r.right);
        offset = Math.abs(cx - fcx);
        break;
    }
    // Sideways: controls on the same line win over anything diagonal.
    const offLine = horizontal && cross > 0 ? 100_000 : 0;
    const score = offLine + gap + cross * 2.5 + offset * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return null;

  // Entering another group: back to the control last used in it.
  const target = groupOf(best);
  if (target && target !== fromGroup) {
    const remembered = groupMemory.get(target.dataset.bpGroup ?? '');
    if (remembered && remembered.isConnected && candidates.includes(remembered)) return remembered;
  }
  return best;
}

/** The control a layer starts on: an explicit autofocus, else the first one. */
export function initialFocus(candidates: HTMLElement[]): HTMLElement | null {
  return candidates.find((el) => el.dataset.bpAutofocus != null) ?? candidates[0] ?? null;
}
