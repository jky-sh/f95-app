import { useInputMethod, type BpAction } from './bpInput';

export type BpGlyphAction = Exclude<BpAction, 'up' | 'down' | 'left' | 'right'>;

const PAD: Record<BpGlyphAction, string> = {
  accept: 'A',
  back: 'B',
  options: 'X',
  search: 'Y',
  prevTab: 'LB',
  nextTab: 'RB',
  menu: '',
};

const KEYS: Record<BpGlyphAction, string> = {
  accept: 'Enter',
  back: 'Esc',
  options: 'X',
  search: '/',
  prevTab: 'Q',
  nextTab: 'E',
  menu: 'M',
};

/** Left/right on the D-pad, or the arrow keys: turning pages, seeking. */
export function BpArrowsGlyph() {
  const method = useInputMethod();
  if (method === 'gamepad') {
    return (
      <span className="bp-glyph bp-glyph--pad bp-glyph--dpad" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" opacity="0.35" />
          <path d="M3 12l4-3.5v7zM21 12l-4-3.5v7z" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <kbd className="bp-glyph bp-glyph--key" aria-hidden>
      ← →
    </kbd>
  );
}

/**
 * The control that triggers an action, as the player sees it: a controller
 * button after gamepad input, a key cap otherwise.
 */
export function BpGlyph({ action }: { action: BpGlyphAction }) {
  const method = useInputMethod();
  if (method === 'gamepad') {
    if (action === 'menu') {
      return (
        <span className="bp-glyph bp-glyph--pad bp-glyph--menu" aria-hidden>
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
      );
    }
    const label = PAD[action];
    const bumper = label.length > 1;
    return (
      <span
        className={`bp-glyph bp-glyph--pad${bumper ? ' bp-glyph--bumper' : ` bp-glyph--${label.toLowerCase()}`}`}
        aria-hidden
      >
        {label}
      </span>
    );
  }
  return (
    <kbd className="bp-glyph bp-glyph--key" aria-hidden>
      {KEYS[action]}
    </kbd>
  );
}
