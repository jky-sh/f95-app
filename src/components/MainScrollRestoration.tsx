import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** `.app-main` scroll offset per history entry, for the session. */
const positions = new Map<string, number>();

/** How long Back waits for a page that loads after mount to grow tall enough. */
const RESTORE_TIMEOUT_MS = 2000;

/**
 * `.app-main` is the single scroll container for every page, so without this
 * a page opened from a scrolled list starts at the list's offset, and Back
 * loses your place. New pages open at the top; Back/Forward return to the
 * offset the entry had, waiting for content that renders after mount (and
 * giving up as soon as the user scrolls). `replace` navigations (filters,
 * tabs kept in the URL) leave the scroll alone.
 */
export function MainScrollRestoration() {
  const location = useLocation();
  const navType = useNavigationType();
  const keyRef = useRef(location.key);

  // Record continuously: when the route changes the old page is already gone
  // and the offset has been clamped to the new content.
  useLayoutEffect(() => {
    const el = mainEl();
    if (!el) return;
    const onScroll = () => positions.set(keyRef.current, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    keyRef.current = location.key;
    if (navType === 'REPLACE') return;
    const el = mainEl();
    if (!el) return;
    const target = navType === 'POP' ? (positions.get(location.key) ?? 0) : 0;
    el.scrollTop = target;
    if (reached(el, target)) return;

    let raf = 0;
    const started = performance.now();
    const stop = () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('mousedown', stop);
      window.removeEventListener('keydown', stop);
    };
    const tick = () => {
      el.scrollTop = target;
      if (reached(el, target) || performance.now() - started > RESTORE_TIMEOUT_MS) {
        stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // The user took over: don't yank the page back.
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('mousedown', stop);
    window.addEventListener('keydown', stop);
    return stop;
  }, [location.key, navType]);

  return null;
}

function mainEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app-main');
}

function reached(el: HTMLElement, target: number): boolean {
  return Math.abs(el.scrollTop - target) <= 1;
}
