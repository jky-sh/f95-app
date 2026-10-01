import { useEffect, useMemo, useRef, useState } from 'react';

/** Hover this long before the first screenshot shows (skips fly-overs). */
const START_DELAY_MS = 250;
/** Time each screenshot stays up. */
const STEP_MS = 1400;
const MAX_SCREENS = 8;

/**
 * While the card is hovered (or focused), its art steps through the game's
 * screenshots, SAM's 400 px previews, with a segment bar showing which one is
 * up; leaving the card fades back to the cover. Screenshots load on the first
 * hover and stay mounted, so hovering again is instant. Listens on the
 * nearest `[data-screen-host]` ancestor, the whole card.
 */
export function ScreenCycle({ screens, cover }: { screens: string[]; cover: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const list = useScreens(screens, cover);
  const [active, setActive] = useState(false);
  /** Screenshots mounted so far (they load in order, on demand). */
  const [mounted, setMounted] = useState(0);
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  /** The screenshot being shown; -1 = the cover. */
  const [shown, setShown] = useState(-1);
  /** The one waiting to load before it can show. */
  const [pending, setPending] = useState(-1);

  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>('[data-screen-host]');
    if (!host || list.length === 0) return;
    let timer = 0;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(true), START_DELAY_MS);
    };
    const stop = (e: Event) => {
      // Moving focus between elements of the same card is not leaving it.
      if (e instanceof FocusEvent && e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
      window.clearTimeout(timer);
      setActive(false);
    };
    host.addEventListener('pointerenter', start);
    host.addEventListener('pointerleave', stop);
    host.addEventListener('focusin', start);
    host.addEventListener('focusout', stop);
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener('pointerenter', start);
      host.removeEventListener('pointerleave', stop);
      host.removeEventListener('focusin', start);
      host.removeEventListener('focusout', stop);
    };
  }, [list.length]);

  // Entering: ask for the first screenshot. Leaving: back to the cover.
  useEffect(() => {
    if (active) {
      setPending(0);
    } else {
      setPending(-1);
      setShown(-1);
    }
  }, [active]);

  // A requested screenshot shows as soon as it has loaded; broken ones are skipped.
  useEffect(() => {
    // A step that fired as the pointer left must not bring a screenshot back.
    if (pending < 0 || !active) return;
    setMounted((m) => Math.max(m, pending + 1));
    if (failed.has(pending)) {
      setPending(failed.size >= list.length ? -1 : (pending + 1) % list.length);
    } else if (loaded.has(pending)) {
      setShown(pending);
      setPending(-1);
    }
  }, [active, pending, loaded, failed, list.length]);

  // While one is up, the next is requested after a pause.
  useEffect(() => {
    if (!active || shown < 0 || list.length < 2) return;
    const timer = window.setTimeout(() => setPending((shown + 1) % list.length), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [active, shown, list.length]);

  if (list.length === 0) return null;
  return (
    <div ref={ref} className={`screen-cycle${active && shown >= 0 ? ' is-active' : ''}`} aria-hidden>
      {list.slice(0, mounted).map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          className={`screen-cycle-img${i === shown ? ' is-shown' : ''}`}
          onLoad={() => setLoaded((prev) => new Set(prev).add(i))}
          onError={() => setFailed((prev) => new Set(prev).add(i))}
        />
      ))}
      {list.length > 1 && (
        <div className="screen-cycle-bar">
          {list.map((src, i) => (
            <span key={src} className={i === shown ? 'is-shown' : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Up to eight screenshots, without the cover or repeats. */
function useScreens(screens: string[], cover: string | null): string[] {
  const key = screens.join('\n');
  return useMemo(() => {
    const seen = new Set(cover ? [cover] : []);
    const out: string[] = [];
    for (const s of key ? key.split('\n') : []) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length === MAX_SCREENS) break;
    }
    return out;
  }, [key, cover]);
}
