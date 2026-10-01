import { useEffect, useState } from 'react';
import { useT } from '../../lib/i18n';
import { useBigPicturePrefs } from '../../lib/bigPicture';
import { bigPictureControllerEnv, type BigPictureControllerEnv } from '../../lib/ipc';

/** The Xbox button, for the controls list. */
export function BpGuideGlyph() {
  return (
    <span className="bp-glyph bp-glyph--pad" aria-hidden>
      <svg viewBox="0 0 16 16" width="13" height="13">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** View and Menu held together, in one cap. */
export function BpChordGlyph() {
  return (
    <span className="bp-glyph bp-glyph--pad bp-glyph--chord" aria-hidden>
      <svg viewBox="0 0 16 16" width="10" height="10">
        <rect x="1.8" y="2.3" width="8" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="6.2" y="6.7" width="8" height="7" rx="1.4" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 16 16" width="10" height="10">
        <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function useControllerEnv(): BigPictureControllerEnv | null {
  const [env, setEnv] = useState<BigPictureControllerEnv | null>(null);
  useEffect(() => {
    let alive = true;
    bigPictureControllerEnv()
      .then((next) => {
        if (alive) setEnv(next);
      })
      .catch(() => {
        // Browser preview: nothing to explain.
      });
    return () => {
      alive = false;
    };
  }, []);
  return env;
}

/**
 * Notes for the Xbox button shortcut: what else on this PC answers the same
 * button (Xbox Game Bar, Steam), or that the button can't be read here.
 */
export function ControllerShortcutNotes({
  className,
  style,
}: {
  className: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const prefs = useBigPicturePrefs();
  const env = useControllerEnv();
  if (!env || !prefs.controllerGuide) return null;
  const keys = env.guideSupported
    ? [
        env.gameBarUsesGuide ? 'bp.settings.gameBarNote' : null,
        env.steamRunning ? 'bp.settings.steamNote' : null,
      ].filter((k): k is string => k != null)
    : ['bp.settings.guideUnsupported'];
  return (
    <>
      {keys.map((key) => (
        <p key={key} className={className} style={style}>
          {t(key)}
        </p>
      ))}
    </>
  );
}
