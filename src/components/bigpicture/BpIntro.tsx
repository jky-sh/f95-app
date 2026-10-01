import { useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { BpLogo } from './BpLogo';
import { BpGlyph } from './BpGlyph';

/** When the interface starts coming in, and when the intro is gone (ms). */
const FULL = { reveal: 2050, done: 2600 };
const SHORT = { reveal: 380, done: 760 };
const SKIPPED = { reveal: 0, done: 380 };

interface Props {
  /** The logo sequence; false keeps only the reveal. */
  full: boolean;
  /** Any key or button: jump to the end. */
  skipped: boolean;
  /** The interface should animate in now (the logo is leaving). */
  onReveal: () => void;
  onDone: () => void;
}

/**
 * Entry sequence: the F95 lockup assembles piece by piece (rules draw in,
 * "ZONE / 002" types itself, the F rises, the red 9 drops in, the 5 draws
 * segment by segment, the play arrow runs the bottom rule), "BIG PICTURE"
 * tracks in, then the logo pushes toward the viewer while the interface
 * arrives behind it. Timing lives in big-picture.css (and bpSound follows
 * it); this only schedules the hand-off.
 */
export function BpIntro({ full, skipped, onReveal, onDone }: Props) {
  const { t } = useT();
  const [leaving, setLeaving] = useState(false);
  const callbacks = useRef({ onReveal, onDone });
  callbacks.current = { onReveal, onDone };

  useEffect(() => {
    const timing = skipped ? SKIPPED : full ? FULL : SHORT;
    const reveal = window.setTimeout(() => {
      setLeaving(true);
      callbacks.current.onReveal();
    }, timing.reveal);
    const done = window.setTimeout(() => callbacks.current.onDone(), timing.done);
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(done);
    };
  }, [full, skipped]);

  return (
    <div
      className={`bp-intro${full ? ' bp-intro--full' : ''}`}
      data-leaving={leaving || undefined}
      aria-hidden
    >
      <div className="bp-intro-glow" />
      {full && (
        <>
          <div className="bp-intro-stage">
            <BpLogo className="bp-intro-logo" />
            <div className="bp-intro-title">
              <span className="bp-intro-title-line" />
              <span className="bp-intro-title-text">Big Picture</span>
              <span className="bp-intro-title-line" />
            </div>
          </div>
          <div className="bp-intro-skip">
            <BpGlyph action="accept" />
            <span>{t('bp.hint.skip')}</span>
          </div>
        </>
      )}
    </div>
  );
}
