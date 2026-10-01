import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useOffline } from '../../contexts/Offline';
import { useRunningGames } from '../../contexts/RunningGames';
import { GAME_DOWNLOAD_MODAL_EVENT, type GameDownloadModalDetail } from '../../lib/gameDownloadModal';
import { useT } from '../../lib/i18n';
import * as library from '../../lib/library';
import { buildLibraryMenu } from '../../lib/contextMenus/buildLibraryMenu';
import { buildStoreMenu } from '../../lib/contextMenus/buildStoreMenu';
import type { LibraryGameActionsDeps } from '../../lib/libraryGameActions';
import {
  closeBigPicture,
  enterBigPictureFullscreen,
  finishBigPictureClose,
  isWindowFullscreen,
  leaveBigPictureFullscreen,
  loadBigPicturePrefs,
  openBigPicture,
  setBigPictureStage,
  setWindowFullscreen,
  useBigPicturePrefs,
  useBigPictureState,
} from '../../lib/bigPicture';
import type { LibraryGame } from '../../types/library';
import type { SamCategory } from '../../types/sam';
import type { ProfileDto } from '../../types';
import {
  BP_FOCUSABLE,
  focusElement,
  focusables,
  findNext,
  forgetGroupFocus,
  initialFocus,
  keyAction,
  navScope,
  rememberGroupFocus,
  scrollStep,
  scrollThrough,
  scrollerOf,
  setInputMethod,
  useGamepad,
  type BpAction,
  type BpDirection,
  type NavScope,
} from './bpInput';
import {
  BP_TABS,
  BpContext,
  BpGamesContext,
  BpProfileContext,
  isTab,
  routeKey,
  type BpActionHandler,
  type BpApi,
  type BpRoute,
  type BpSheetSpec,
  type BpTab,
} from './BpContext';
import { playSound, primeSounds, setSoundsEnabled } from './bpSound';
import { BpIntro } from './BpIntro';
import { BpBackdrop } from './BpParts';
import { BpHintBar, BpMenu, BpSheet, BpTopBar, BpViewer } from './BpChrome';
import { BpFileChoiceHost, BpInstall, type FileChoiceControl } from './BpInstall';
import { BpLaunch } from './BpLaunch';
import { BpToast } from './BpToast';
import { BpHome } from './screens/BpHome';
import { BpLibrary } from './screens/BpLibrary';
import { BpStore } from './screens/BpStore';
import { BpStoreBrowse } from './screens/BpStoreBrowse';
import { BpDownloads } from './screens/BpDownloads';
import { BpSearch } from './screens/BpSearch';
import { BpGame } from './screens/BpGame';
import { BpStoreGame } from './screens/BpStoreGame';
import { BpSettings } from './screens/BpSettings';
import { BpProfile } from './screens/BpProfile';
import { BpMedia } from './screens/BpMedia';
import { BpNews, showNewsSection } from './screens/BpNews';
import { BpFriends } from './screens/BpFriends';
import { BpFriend } from './screens/BpFriend';

/** Mounted once in the app shell: renders Big Picture over everything while open. */
export function BigPictureHost({ profile }: { profile: ProfileDto }) {
  const { status, origin } = useBigPictureState();

  // "Start in Big Picture": once per sign-in.
  useEffect(() => {
    void loadBigPicturePrefs().then((p) => {
      if (p.onStartup) openBigPicture(null);
    });
  }, []);

  if (status === 'closed') return null;
  return createPortal(
    <BigPicture profile={profile} origin={origin} closing={status === 'closing'} />,
    document.body,
  );
}

type Phase = 'intro' | 'enter' | 'main' | 'outro';
type EnterKind = 'none' | 'push' | 'pop' | 'tab-left' | 'tab-right';

/** How long the interface takes to arrive after the intro hands off. */
const ENTER_MS = 1100;
/** Exit: the interface leaves, then the layer shrinks back into the button. */
const OUTRO_UI_MS = 260;
const OUTRO_TOTAL_MS = 720;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

function canMorph(): boolean {
  return typeof (document as ViewTransitionDoc).startViewTransition === 'function' && !reducedMotion();
}

/**
 * Runs `update` as a view transition: the element named `bp-art` before it
 * (a tile's art) morphs into the one named after it (the game's header art).
 */
function morph(update: () => void, prepare?: () => void): void {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  const vt = doc.startViewTransition(() => {
    flushSync(update);
    prepare?.();
  });
  // A skipped transition (hidden window, another one started) still applies
  // the update; only the animation is lost, which is fine.
  vt.ready.catch(() => undefined);
  void vt.finished
    .catch(() => undefined)
    .then(() => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-bp-morph]')) {
        el.style.removeProperty('view-transition-name');
        delete el.dataset.bpMorph;
      }
    });
}

function nameForMorph(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.style.setProperty('view-transition-name', 'bp-art');
  el.dataset.bpMorph = '';
}

interface Hints {
  a: string | null;
  x: string | null;
}

function BigPicture({
  profile,
  origin,
  closing,
}: {
  profile: ProfileDto;
  origin: { x: number; y: number } | null;
  closing: boolean;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const { running, launch, launching, cancelLaunch } = useRunningGames();
  const { isOffline } = useOffline();
  const prefs = useBigPicturePrefs();
  const rootRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('intro');
  const [skipped, setSkipped] = useState(false);
  const [fullIntro] = useState(() => prefs.intro && !reducedMotion());
  /** The section at the bottom, then screens opened over it. */
  const [stack, setStack] = useState<BpRoute[]>([{ screen: 'home' }]);
  const [visitedTabs, setVisitedTabs] = useState<BpTab[]>(['home']);
  const [enterKind, setEnterKind] = useState<EnterKind>('none');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<BpSheetSpec | null>(null);
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null);
  /** Install / update panel (`openGameDownloadModal` while Big Picture is open). */
  const [install, setInstall] = useState<GameDownloadModalDetail | null>(null);
  /** B in the install panel: a step back (libraries to links) before closing. */
  const installBack = useRef<(() => boolean) | null>(null);
  /** The download asking which of its files to get, while that panel is up. */
  const [choiceId, setChoiceId] = useState<number | null>(null);
  const fileChoice = useRef<FileChoiceControl | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [games, setGames] = useState<LibraryGame[] | null>(null);
  const [hints, setHints] = useState<Hints>({ a: null, x: null });
  const [fullscreen, setFullscreen] = useState(false);
  /** A full-screen reader or player owns the controller while it is open. */
  const actionHandler = useRef<BpActionHandler | null>(null);

  const top = stack[stack.length - 1];
  const tab: BpTab = isTab(stack[0]) ? stack[0].screen : 'home';
  const launchingEntry = launching.size > 0 ? [...launching.values()][0] : null;

  // Handlers read the latest state from here (listeners are bound once).
  const liveState = {
    phase,
    stack,
    menuOpen,
    sheet,
    viewer,
    install,
    choiceId,
    launchingEntry,
    tab,
  };
  const live = useRef(liveState);
  live.current = liveState;

  /* --- entrance / exit ---------------------------------------------------- */

  useEffect(() => {
    setSoundsEnabled(prefs.sounds);
  }, [prefs.sounds]);

  // Once, even when StrictMode mounts twice.
  const introSounded = useRef(false);
  useEffect(() => {
    if (introSounded.current) return;
    introSounded.current = true;
    primeSounds();
    playSound(fullIntro ? 'enter' : 'enterShort');
  }, [fullIntro]);

  useEffect(() => {
    let cancelled = false;
    const sync = () =>
      void isWindowFullscreen().then((on) => {
        if (!cancelled) setFullscreen(on);
      });
    void loadBigPicturePrefs().then(async (p) => {
      if (cancelled) return;
      if (p.fullscreen) await enterBigPictureFullscreen();
      sync();
    });
    // Fullscreen also changes from Settings, F11 or the system.
    window.addEventListener('resize', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', sync);
    };
  }, []);

  const onReveal = useCallback(() => {
    setPhase((p) => (p === 'intro' ? 'enter' : p));
  }, []);
  const [introDone, setIntroDone] = useState(false);
  const onIntroDone = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    if (phase !== 'enter') return;
    setBigPictureStage('covered');
    const timer = window.setTimeout(() => setPhase((p) => (p === 'enter' ? 'main' : p)), ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!closing) return;
    setPhase('outro');
    setMenuOpen(false);
    setSheet(null);
    setViewer(null);
    setInstall(null);
    setBigPictureStage('open');
    playSound('exit');
    void leaveBigPictureFullscreen();
    const shrink = window.setTimeout(() => setBigPictureStage('leaving'), OUTRO_UI_MS);
    const done = window.setTimeout(() => finishBigPictureClose(), OUTRO_TOTAL_MS);
    return () => {
      window.clearTimeout(shrink);
      window.clearTimeout(done);
    };
  }, [closing]);

  useEffect(() => () => forgetGroupFocus(), []);

  /* --- library snapshot ---------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      library
        .list({ sort: 'last_played' })
        .then((all) => {
          if (!cancelled) setGames(all);
        })
        .catch((err) => console.warn('[big-picture] library load failed', err));
    void load();
    const stop = library.onLibraryChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 120);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
    };
  }, []);

  /* --- navigation ---------------------------------------------------------- */

  /** Focused control per screen, to land back on it after Back. */
  const focusMemory = useRef(new Map<string, HTMLElement>());

  const rememberFocus = useCallback(() => {
    const active = document.activeElement;
    const current = live.current.stack[live.current.stack.length - 1];
    // A panel's own controls go away with it (a sheet item that opens the install panel).
    const onScreen = active instanceof HTMLElement && active.matches(BP_FOCUSABLE) && !active.closest('[data-bp-layer]');
    if (onScreen && current) focusMemory.current.set(routeKey(current), active);
  }, []);

  const push = useCallback(
    (route: BpRoute, from?: HTMLElement | null) => {
      const current = live.current.stack;
      if (routeKey(current[current.length - 1]) === routeKey(route)) return;
      rememberFocus();
      const update = () => {
        setStack((prev) => {
          // Already open further down (game → store → game): go back to it.
          const at = prev.findIndex((r) => routeKey(r) === routeKey(route));
          return at >= 0 ? prev.slice(0, at + 1) : [...prev, route];
        });
        setEnterKind(from && canMorph() ? 'none' : 'push');
      };
      if (from && canMorph()) {
        nameForMorph(from);
        morph(update, () => {
          from.style.removeProperty('view-transition-name');
          delete from.dataset.bpMorph;
        });
      } else {
        update();
      }
    },
    [rememberFocus],
  );

  const pop = useCallback(() => {
    const current = live.current.stack;
    if (current.length < 2) return;
    const below = current[current.length - 2];
    const target = focusMemory.current.get(routeKey(below));
    const art = target?.isConnected ? target.querySelector<HTMLElement>('.bp-tile-art') : null;
    const morphing = art != null && canMorph();
    const update = () => {
      // Two Backs during one transition must not empty the stack.
      setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      setEnterKind(morphing ? 'none' : 'pop');
    };
    if (morphing) morph(update, () => nameForMorph(art));
    else update();
  }, []);

  const switchTab = useCallback(
    (next: BpTab) => {
      const { stack: current, tab: from } = live.current;
      if (current.length === 1 && current[0].screen === next) return;
      rememberFocus();
      setStack([{ screen: next }]);
      setVisitedTabs((v) => (v.includes(next) ? v : [...v, next]));
      // Same section under a detail screen: that is going back to it.
      if (current[0].screen === next) setEnterKind('pop');
      else setEnterKind(BP_TABS.indexOf(next) > BP_TABS.indexOf(from) ? 'tab-right' : 'tab-left');
    },
    [rememberFocus],
  );

  const exit = useCallback(
    (to?: string) => {
      if (to) navigate(to);
      closeBigPicture();
    },
    [navigate],
  );

  // Actions built for the desktop pages navigate with the router; inside Big
  // Picture the same paths open its own screens, anything else leaves it.
  const bpNavigate = useCallback(
    (to: To | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        pop();
        return;
      }
      const path = typeof to === 'string' ? to : (to.pathname ?? '');
      const media = /^\/library\/game\/([^/?#]+)\/view$/.exec(path);
      if (media) {
        push({ screen: 'media', threadId: decodeURIComponent(media[1]) });
        return;
      }
      const libraryGame = /^\/library\/game\/([^/?#]+)$/.exec(path);
      if (libraryGame) {
        push({ screen: 'game', threadId: decodeURIComponent(libraryGame[1]) });
        return;
      }
      if (/^\/library\/?(\?.*)?$/.test(path)) {
        switchTab('library');
        return;
      }
      const storeGame = /^\/store\/game\/([^/?#]+)(?:\?cat=(\w+))?/.exec(path);
      if (storeGame) {
        push({
          screen: 'storeGame',
          threadId: decodeURIComponent(storeGame[1]),
          category: (storeGame[2] as SamCategory | undefined) ?? 'games',
        });
        return;
      }
      if (/^\/downloads\/?$/.test(path)) {
        switchTab('downloads');
        return;
      }
      if (/^\/profile\/?$/.test(path)) {
        push({ screen: 'profile' });
        return;
      }
      // Member links (activity feeds, follower lists): your own is the profile.
      const member = /^\/friends\/(\d+)\/?(?:[?#].*)?$/.exec(path);
      if (member) {
        push(member[1] === profile.userId ? { screen: 'profile' } : { screen: 'friend', userId: member[1] });
        return;
      }
      if (/^\/friends\/?(?:[?#].*)?$/.test(path)) {
        switchTab('friends');
        return;
      }
      if (/^\/news\/?(?:[?#].*)?$/.test(path)) {
        switchTab('news');
        return;
      }
      if (/^\/alerts\/?(?:[?#].*)?$/.test(path)) {
        showNewsSection('alerts');
        switchTab('news');
        return;
      }
      navigate(to, options);
      closeBigPicture();
    },
    [navigate, push, pop, switchTab, profile.userId],
  );

  const depsRef = useRef<LibraryGameActionsDeps>(null!);
  depsRef.current = {
    navigate: bpNavigate as LibraryGameActionsDeps['navigate'],
    launch,
    running,
    isOffline,
    t,
  };

  const openLayer = useCallback(
    (open: () => void) => {
      rememberFocus();
      playSound('open');
      open();
    },
    [rememberFocus],
  );

  const api = useMemo<BpApi>(
    () => ({
      push,
      back: () => goBackRef.current(),
      switchTab,
      openSheet: (spec) => openLayer(() => setSheet(spec)),
      openViewer: (images, index) => {
        if (images.length) openLayer(() => setViewer({ images, index }));
      },
      openMenu: () => openLayer(() => setMenuOpen(true)),
      exit,
      setBackdrop,
      gameDeps: () => depsRef.current,
      openGame: (game, from) => push({ screen: 'game', threadId: game.threadId }, from),
      openStoreGame: (card, category, from) =>
        push({ screen: 'storeGame', threadId: card.threadId, category, card }, from),
      openGameOptions: (game) =>
        openLayer(() =>
          setSheet({
            title: game.title,
            subtitle: game.currentVersion,
            art: game.thumbnailUrl,
            // The page itself is already one A press away.
            items: buildLibraryMenu(game, depsRef.current).filter((i) => i.id !== 'detail'),
          }),
        ),
      openStoreOptions: (card, category) => {
        void library.isInLibrary(card.threadId).then((inLibrary) =>
          openLayer(() =>
            setSheet({
              title: card.title,
              subtitle: card.creator,
              art: card.thumbnailUrl,
              items: buildStoreMenu(card, {
                navigate: bpNavigate as LibraryGameActionsDeps['navigate'],
                category,
                isOffline: depsRef.current.isOffline,
                inLibrary,
                t: depsRef.current.t,
              }),
            }),
          ),
        );
      },
      setActionHandler: (handler) => {
        actionHandler.current = handler;
      },
      layerHost: () => rootRef.current,
    }),
    [push, switchTab, exit, openLayer, bpNavigate],
  );

  /** Back to the control the screen had before a panel opened over it. */
  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      // Another panel took over meanwhile: it keeps the focus.
      if (rootRef.current?.querySelector('[data-bp-layer]')) return;
      const current = live.current.stack[live.current.stack.length - 1];
      const el = focusMemory.current.get(routeKey(current));
      if (el?.isConnected) focusElement(el, { scroll: false });
    });
  }, []);

  const closeLayer = useCallback(
    (restore: boolean) => {
      setSheet(null);
      setMenuOpen(false);
      setViewer(null);
      setInstall(null);
      if (restore) restoreFocus();
    },
    [restoreFocus],
  );

  // Install and Update anywhere in Big Picture (buttons, the options sheet)
  // open its own panel; the desktop dialog stays out of the way.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<GameDownloadModalDetail>).detail;
      if (!detail?.threadId || live.current.phase === 'outro') return;
      openLayer(() => {
        setSheet(null);
        setMenuOpen(false);
        setInstall(detail);
      });
    };
    window.addEventListener(GAME_DOWNLOAD_MODAL_EVENT, onOpen);
    return () => window.removeEventListener(GAME_DOWNLOAD_MODAL_EVENT, onOpen);
  }, [openLayer]);

  const goBack = useCallback(() => {
    const s = live.current;
    if (s.launchingEntry) {
      playSound('back');
      cancelLaunch(s.launchingEntry.game.threadId);
      return;
    }
    if (s.choiceId != null) {
      // Like closing the desktop dialog: the waiting download is cancelled.
      if (fileChoice.current && !fileChoice.current.busy) fileChoice.current.cancel();
      return;
    }
    if (s.install) {
      if (installBack.current?.()) {
        playSound('back');
        return;
      }
      playSound('close');
      closeLayer(true);
      return;
    }
    if (s.viewer || s.sheet || s.menuOpen) {
      playSound('close');
      closeLayer(true);
      return;
    }
    if (s.stack.length > 1) {
      playSound('back');
      pop();
      return;
    }
    if (s.stack[0].screen !== 'home') {
      playSound('back');
      switchTab('home');
      return;
    }
    openLayer(() => setMenuOpen(true));
  }, [cancelLaunch, closeLayer, pop, switchTab, openLayer]);
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  /* --- focus ---------------------------------------------------------------- */

  /** What `ensureFocus` focused by itself, until the player moves. */
  const autoFocused = useRef<HTMLElement | null>(null);
  /** Hint bar update for a control (focus events don't fire while the window is inactive). */
  const showHintsRef = useRef<(el: HTMLElement) => void>(() => undefined);

  // Land on the screen's remembered control (or its first one) whenever the
  // screen changes, and whenever its content arrives with nothing focused.
  const ensureFocus = useCallback(() => {
    const root = rootRef.current;
    if (!root || live.current.phase === 'intro') return;
    const scope = navScope(root);
    const active = document.activeElement;
    if (active instanceof HTMLElement && scope.el.contains(active) && active !== scope.el) {
      if (active.matches(scope.dialog ? '*' : BP_FOCUSABLE) && active.checkVisibility?.() !== false) {
        // Placed while the screen was still filling in (a filter chip before
        // the grid loaded): move to the control it asks for once it shows up.
        if (active === autoFocused.current && active.dataset.bpAutofocus == null) {
          const wanted = scope.el.querySelector<HTMLElement>(
            scope.el === root ? '.bp-screen:not([hidden]) [data-bp-autofocus]' : '[data-bp-autofocus]',
          );
          if (wanted && wanted !== active) {
            focusElement(wanted);
            autoFocused.current = wanted;
          }
        }
        return;
      }
    }
    const current = live.current.stack[live.current.stack.length - 1];
    const remembered = scope.el === root ? focusMemory.current.get(routeKey(current)) : null;
    // On a screen, wait for its own controls (it may still be loading)
    // rather than parking the focus on the top bar.
    const candidates = focusables(scope).filter((el) => scope.el !== root || el.closest('.bp-screen'));
    const target =
      remembered?.isConnected && remembered.checkVisibility?.() !== false
        ? remembered
        : initialFocus(candidates);
    if (target) {
      focusElement(target);
      showHintsRef.current(target);
      autoFocused.current = target === remembered ? null : target;
    }
  }, []);

  // A download asking which file to get shows up over whatever is on screen:
  // keep the spot (before the focus moves into it) to come back to after.
  const shownChoice = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (choiceId === shownChoice.current) return;
    const opening = shownChoice.current == null;
    shownChoice.current = choiceId;
    if (choiceId == null) {
      restoreFocus();
    } else if (opening) {
      rememberFocus();
      playSound('open');
    }
  }, [choiceId, rememberFocus, restoreFocus]);

  useLayoutEffect(() => {
    ensureFocus();
  }, [top, menuOpen, sheet, viewer, install, choiceId, phase, ensureFocus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(ensureFocus);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ensureFocus]);

  // Track focus for the hint bar and for coming back to groups.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const showHints = (el: HTMLElement) =>
      setHints((prev) => {
        const next = { a: el.dataset.bpA ?? t('bp.hint.select'), x: el.dataset.bpX ?? null };
        return prev.a === next.a && prev.x === next.x ? prev : next;
      });
    showHintsRef.current = showHints;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!el.matches?.(BP_FOCUSABLE)) return;
      rememberGroupFocus(el);
      showHints(el);
    };
    // A dialog from the rest of the app (a confirmation): plain A, no X.
    const onDialogFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!root.contains(el) && el.closest?.('[aria-modal="true"]')) showHints(el);
    };
    // The focused control can change its action in place (Play → Stop).
    const observer = new MutationObserver((records) => {
      const active = document.activeElement;
      if (records.some((r) => r.target === active)) showHints(active as HTMLElement);
    });
    observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['data-bp-a', 'data-bp-x'] });
    root.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusin', onDialogFocus);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusin', onDialogFocus);
      observer.disconnect();
    };
  }, [t]);

  /* --- input ---------------------------------------------------------------- */

  const move = useCallback((scope: NavScope, dir: BpDirection) => {
    const root = rootRef.current!;
    const candidates = scope.dialog ? focusables(scope) : contentFocusables(scope, root);
    const active = document.activeElement as HTMLElement | null;
    const current = active && candidates.includes(active) ? active : null;
    const vertical = dir === 'up' || dir === 'down';
    if (!current) {
      const first = initialFocus(candidates);
      if (first) focusElement(first);
      else if (vertical) scrollStep(null, root, dir);
      return;
    }
    // A long text being read scrolls through before the focus moves on.
    if (vertical && scrollThrough(current, dir)) return;
    const next = findNext(current, dir, candidates);
    if (next) {
      focusElement(next);
      playSound('move');
      return;
    }
    // Nothing that way: keep scrolling the page if there is more of it.
    if (vertical && scrollerOf(current) && scrollStep(current, root, dir)) return;
    // Edge: a small nudge instead of nothing.
    playSound('edge');
    current.dataset.bpNudge = dir;
    window.setTimeout(() => {
      if (current.dataset.bpNudge === dir) delete current.dataset.bpNudge;
    }, 220);
  }, []);

  const handleAction = useCallback(
    (action: BpAction) => {
      const root = rootRef.current;
      if (!root) return;
      const s = live.current;
      if (s.phase === 'intro') {
        setSkipped(true);
        return;
      }
      if (s.phase === 'outro') return;
      autoFocused.current = null;
      const scope = navScope(root);
      const active = document.activeElement as HTMLElement | null;
      const activeInScope = active && scope.el.contains(active) && active !== scope.el ? active : null;

      if (scope.dialog) {
        // A dialog from the desktop interface (download hosts, confirmations):
        // directions move, A presses, B is its Escape.
        if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
          move(scope, action);
        } else if (action === 'accept') {
          if (activeInScope) activeInScope.click();
          else move(scope, 'down');
        } else if (action === 'back') {
          playSound('close');
          sendEscape();
        }
        return;
      }

      if (s.viewer) {
        if (action === 'left' || action === 'right' || action === 'accept') {
          const step = action === 'left' ? -1 : 1;
          playSound('page');
          setViewer((v) => v && { ...v, index: (v.index + step + v.images.length) % v.images.length });
          return;
        }
        if (action === 'back') goBack();
        return;
      }

      const panel = s.menuOpen || s.sheet != null || s.install != null || s.choiceId != null;

      // A reader or player open on top takes the controller first.
      if (!panel && !s.launchingEntry && actionHandler.current?.(action)) return;

      switch (action) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          move(scope, action);
          break;
        case 'accept':
          if (activeInScope?.matches(BP_FOCUSABLE)) activeInScope.click();
          else ensureFocus();
          break;
        case 'back':
          goBack();
          break;
        case 'options':
          if (activeInScope?.dataset.bpX != null) {
            const rect = activeInScope.getBoundingClientRect();
            activeInScope.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
              }),
            );
          }
          break;
        case 'search':
          if (!panel) {
            playSound('open');
            push({ screen: 'search' });
          }
          break;
        case 'menu':
          if (s.menuOpen) {
            playSound('close');
            closeLayer(true);
          } else if (!panel) {
            openLayer(() => setMenuOpen(true));
          }
          break;
        case 'prevTab':
        case 'nextTab': {
          if (panel) break;
          const i = BP_TABS.indexOf(s.tab);
          const step = action === 'prevTab' ? -1 : 1;
          playSound('tab');
          switchTab(BP_TABS[(i + step + BP_TABS.length) % BP_TABS.length]);
          break;
        }
      }
    },
    [move, goBack, ensureFocus, push, closeLayer, openLayer, switchTab],
  );

  useEffect(() => {
    const root = rootRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (sendingEscape) return;
      if (e.key === 'F11' || (e.altKey && e.key === 'Enter')) {
        e.preventDefault();
        void toggleFullscreen(setFullscreen);
        return;
      }
      const action = keyAction(e);
      if (!action) return;
      if (root && navScope(root).dialog && !['up', 'down', 'left', 'right'].includes(action)) {
        // The dialog's own keys (Enter, Escape) keep working as they do.
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setInputMethod('keyboard');
      handleAction(action);
    };
    const onMouse = (e: MouseEvent) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) < 3) return;
      setInputMethod('mouse');
      // Hover moves the focus like in the rest of Big Picture (no scrolling).
      const target = (e.target as HTMLElement).closest?.<HTMLElement>(BP_FOCUSABLE);
      if (target && target !== document.activeElement && live.current.phase !== 'intro') {
        if (root && navScope(root).el.contains(target)) {
          autoFocused.current = null;
          target.focus({ preventScroll: true });
          playSound('move');
        }
      }
    };
    const onPointerDown = () => {
      if (live.current.phase === 'intro') setSkipped(true);
    };
    // Every press on a control, by mouse or by A, confirms with a sound.
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>(BP_FOCUSABLE);
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
      const role = el.getAttribute('role');
      playSound(role === 'tab' ? 'tab' : role === 'switch' ? 'toggle' : 'select');
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousemove', onMouse, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    root?.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousemove', onMouse, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      root?.removeEventListener('click', onClick, true);
    };
  }, [handleAction]);

  useGamepad(phase !== 'outro', {
    onAction: handleAction,
    onScroll: (dy) => {
      const root = rootRef.current;
      const active = document.activeElement as HTMLElement | null;
      const scroller =
        (active && scrollerOf(active)) ??
        root?.querySelector<HTMLElement>('.bp-screen:not([hidden]) [data-bp-scroll-y]');
      // Instant: a smooth scroll restarted every frame barely moves.
      scroller?.scrollBy({ top: dy, behavior: 'instant' });
    },
  });

  /* --- render --------------------------------------------------------------- */

  const style = {
    '--bp-ox': origin ? `${origin.x}px` : '50%',
    '--bp-oy': origin ? `${origin.y}px` : '50%',
  } as React.CSSProperties;

  const backdropMode = top.screen === 'home' ? 'hero' : 'ambient';

  return (
    <BpContext.Provider value={api}>
      <BpGamesContext.Provider value={games}>
        <BpProfileContext.Provider value={profile}>
          <div
            ref={rootRef}
            className="bp-root"
            data-phase={phase}
            style={style}
            role="application"
            aria-label={t('bp.title')}
          >
            <BpBackdrop art={backdrop} mode={backdropMode} />

            <div className="bp-frame" aria-hidden={phase === 'intro' || undefined}>
              <BpTopBar
                profile={profile}
                tab={tab}
                draggable={!fullscreen}
                onTab={switchTab}
                onSearch={() => push({ screen: 'search' })}
                onProfile={() => push({ screen: 'profile' })}
                onExit={() => closeBigPicture()}
              />
              <main className="bp-stage">
                {/* Sections stay mounted once visited (scroll, loaded pages);
                    screens opened over them stack on top. */}
                {visitedTabs.map((id) => {
                  const active = stack.length === 1 && stack[0].screen === id;
                  return (
                    <section
                      key={id}
                      className="bp-screen"
                      data-screen={id}
                      data-enter={active ? enterKind : undefined}
                      hidden={!active}
                    >
                      <Screen route={{ screen: id }} active={active} />
                    </section>
                  );
                })}
                {stack.slice(1).map((route, i) => {
                  const active = i === stack.length - 2;
                  return (
                    <section
                      key={routeKey(route)}
                      className="bp-screen"
                      data-screen={route.screen}
                      data-enter={active ? enterKind : undefined}
                      hidden={!active}
                    >
                      <Screen route={route} active={active} />
                    </section>
                  );
                })}
              </main>
              <BpHintBar
                hints={hints}
                onMenu={() => handleAction('menu')}
                onAccept={() => handleAction('accept')}
                onBack={goBack}
                onOptions={() => handleAction('options')}
                onSearch={() => handleAction('search')}
              />
            </div>

            {menuOpen && (
              <BpMenu
                profile={profile}
                tab={tab}
                fullscreen={fullscreen}
                onClose={() => {
                  playSound('close');
                  closeLayer(true);
                }}
                onTab={(next) => {
                  closeLayer(false);
                  switchTab(next);
                }}
                onSearch={() => {
                  closeLayer(false);
                  push({ screen: 'search' });
                }}
                onProfile={() => {
                  closeLayer(false);
                  push({ screen: 'profile' });
                }}
                onSettings={() => {
                  closeLayer(false);
                  push({ screen: 'settings' });
                }}
                onFullscreen={() => void toggleFullscreen(setFullscreen)}
                onMinimize={() => {
                  closeLayer(true);
                  void getCurrentWindow().minimize().catch(() => undefined);
                }}
                onDesktop={() => exit()}
              />
            )}
            {sheet && (
              <BpSheet
                spec={sheet}
                onClose={() => {
                  playSound('close');
                  closeLayer(true);
                }}
                onPick={(item) => {
                  closeLayer(true);
                  void Promise.resolve(item.onClick()).catch((err) =>
                    console.warn('[big-picture] action failed', err),
                  );
                }}
              />
            )}
            {viewer && (
              <BpViewer
                images={viewer.images}
                index={viewer.index}
                onIndex={(index) => setViewer((v) => v && { ...v, index })}
                onClose={() => {
                  playSound('close');
                  closeLayer(true);
                }}
              />
            )}
            {install && (
              <BpInstall
                key={`${install.threadId}:${install.mode}`}
                request={install}
                backRef={installBack}
                onClose={(started) => {
                  if (!started) playSound('close');
                  closeLayer(true);
                }}
              />
            )}
            <BpFileChoiceHost onChange={setChoiceId} controlRef={fileChoice} />
            {launchingEntry && phase !== 'intro' && <BpLaunch entry={launchingEntry} />}
            <BpToast />

            {!introDone && (
              <BpIntro full={fullIntro} skipped={skipped} onReveal={onReveal} onDone={onIntroDone} />
            )}
          </div>
        </BpProfileContext.Provider>
      </BpGamesContext.Provider>
    </BpContext.Provider>
  );
}

function Screen({ route, active }: { route: BpRoute; active: boolean }) {
  switch (route.screen) {
    case 'home':
      return <BpHome />;
    case 'library':
      return <BpLibrary />;
    case 'store':
      return <BpStore />;
    case 'news':
      return <BpNews active={active} />;
    case 'friends':
      return <BpFriends active={active} />;
    case 'downloads':
      return <BpDownloads />;
    case 'search':
      return <BpSearch />;
    case 'settings':
      return <BpSettings />;
    case 'profile':
      return <BpProfile />;
    case 'game':
      return <BpGame threadId={route.threadId} />;
    case 'storeGame':
      return <BpStoreGame threadId={route.threadId} category={route.category} card={route.card} />;
    case 'storeBrowse':
      return <BpStoreBrowse initialCategory={route.category} />;
    case 'media':
      return <BpMedia threadId={route.threadId} active={active} />;
    case 'friend':
      return <BpFriend userId={route.userId} active={active} />;
  }
}

/** Focusable controls of the screen: the top bar and the visible screen, or a panel. */
function contentFocusables(scope: NavScope, root: HTMLElement): HTMLElement[] {
  const all = focusables(scope);
  if (scope.el !== root) return all;
  // The screen first, so it (not the top bar) gets the initial focus.
  const screen = all.filter((el) => el.closest('.bp-screen'));
  return [...screen, ...all.filter((el) => !el.closest('.bp-screen'))];
}

/** Set while we hand an Escape to a desktop dialog, so our own listener lets it through. */
let sendingEscape = false;

function sendEscape(): void {
  sendingEscape = true;
  try {
    const init = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', init));
  } finally {
    sendingEscape = false;
  }
}

async function toggleFullscreen(set: (on: boolean) => void): Promise<void> {
  const next = !(await isWindowFullscreen());
  await setWindowFullscreen(next);
  set(await isWindowFullscreen());
}
