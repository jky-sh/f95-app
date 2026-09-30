import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../../lib/i18n';
import {
  getExperimentalSettings,
  loadExperimentalSettings,
  saveExperimentalSettings,
  subscribeExperimentalSettings,
  type ExperimentalSettings,
} from '../../lib/experimentalSettings';
import * as ipc from '../../lib/ipc';
import * as library from '../../lib/library';
import type { OverlayAnchorStatus, OverlayContext } from '../../types/overlay';
import { OverlayAchievementsPanel } from './OverlayAchievementsPanel';
import { OverlayBrandBar } from './OverlayBrandBar';
import { closeOverlayEmbeddedBrowser, OverlayBrowserPanel } from './OverlayBrowserPanel';
import { OverlayDock } from './OverlayDock';
import { OverlayFloatPanel } from './OverlayFloatPanel';
import { OverlayGamePanel } from './OverlayGamePanel';
import { OverlayGuidesPanel } from './OverlayGuidesPanel';
import { OverlayHotkeyBadge } from './OverlayHotkeyBadge';
import { OverlayNotesPanel } from './OverlayNotesPanel';
import {
  clampAllPanelLayouts,
  clampPanelLayout,
  type OverlayPanelLayout,
  type OverlayPanelLayouts,
} from './overlayPanelLayouts';
import { OVERLAY_TAB_LABEL_KEYS, OVERLAY_TAB_ORDER, type OverlayTab } from './overlayTypes';

interface RunningOption {
  threadId: string;
  title: string;
}

export function GameOverlayApp() {
  const { t } = useT();
  const [exp, setExp] = useState<ExperimentalSettings>(() => getExperimentalSettings());
  const [context, setContext] = useState<OverlayContext | null>(null);
  const [running, setRunning] = useState<RunningOption[]>([]);
  const [anchor, setAnchor] = useState<OverlayAnchorStatus | null>(null);
  const [panelLayouts, setPanelLayouts] = useState<OverlayPanelLayouts>(
    () => getExperimentalSettings().overlayPanelLayouts,
  );
  const [focusedPanel, setFocusedPanel] = useState<OverlayTab | null>('notes');
  /** A link the game or guides panel asked the browser panel to open. */
  const [browserRequest, setBrowserRequest] = useState<{ url: string; nonce: number } | null>(null);
  /** Counts showings: the browser page is torn down whenever the overlay closes. */
  const [showKey, setShowKey] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshRunning = useCallback(async () => {
    const list = await ipc.runningGames();
    const opts: RunningOption[] = [];
    for (const r of list) {
      const g = await library.get(r.threadId);
      opts.push({ threadId: r.threadId, title: g?.title ?? r.threadId });
    }
    setRunning(opts);
    return opts;
  }, []);

  useEffect(() => {
    void loadExperimentalSettings().then((s) => {
      setExp(s);
      setPanelLayouts(s.overlayPanelLayouts);
    });
    return subscribeExperimentalSettings((s) => {
      setExp(s);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ipc.overlayGetContext().then((ctx) => {
      if (!cancelled && ctx) setContext(ctx);
    });
    void refreshRunning();
    const unsubs: Array<() => void> = [];
    // Rust sends the context each time it shows the overlay.
    void listen<OverlayContext>('overlay:context', (e) => {
      if (cancelled) return;
      setContext(e.payload);
      setShowKey((k) => k + 1);
    }).then((fn) => unsubs.push(fn));
    void listen<{ pid: number; attachMode?: string }>('overlay:anchored', () => {
      if (!cancelled) void ipc.overlayGetAnchorStatus().then(setAnchor);
    }).then((fn) => unsubs.push(fn));
    void ipc.overlayGetAnchorStatus().then((s) => {
      if (!cancelled) setAnchor(s);
    });
    const runningId = window.setInterval(() => {
      void refreshRunning();
    }, 4000);
    const anchorId = window.setInterval(() => {
      if (!cancelled) void ipc.overlayGetAnchorStatus().then(setAnchor);
    }, 1500);
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      window.clearInterval(runningId);
      window.clearInterval(anchorId);
    };
  }, [refreshRunning]);

  const scheduleSaveLayouts = useCallback((layouts: OverlayPanelLayouts) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveExperimentalSettings({ overlayPanelLayouts: layouts });
    }, 400);
  }, []);

  const updatePanelLayout = useCallback(
    (tab: OverlayTab, patch: Partial<OverlayPanelLayout>) => {
      setPanelLayouts((prev) => {
        const next = clampAllPanelLayouts(
          { ...prev, [tab]: { ...prev[tab], ...patch } },
          window.innerWidth,
          window.innerHeight,
        );
        scheduleSaveLayouts(next);
        return next;
      });
    },
    [scheduleSaveLayouts],
  );

  useEffect(() => {
    const onResize = () => {
      setPanelLayouts((prev) => {
        const next = clampAllPanelLayouts(prev, window.innerWidth, window.innerHeight);
        scheduleSaveLayouts(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scheduleSaveLayouts]);

  const selectGame = useCallback(async (threadId: string) => {
    const g = await library.get(threadId);
    if (!g) return;
    const ctx: OverlayContext = {
      threadId: g.threadId,
      title: g.title,
      thumbnailUrl: g.thumbnailUrl || null,
      sessionId: 0,
    };
    await ipc.overlaySetContext(ctx);
    setContext(ctx);
  }, []);

  const closePanel = useCallback(
    (tab: OverlayTab) => {
      setPanelLayouts((prev) => {
        const next = clampAllPanelLayouts(
          { ...prev, [tab]: { ...prev[tab], open: false } },
          window.innerWidth,
          window.innerHeight,
        );
        void saveExperimentalSettings({ overlayPanelLayouts: next });
        return next;
      });
    },
    [],
  );

  const close = useCallback(() => {
    void closeOverlayEmbeddedBrowser();
    void ipc.overlayHide();
    void getCurrentWindow().hide();
  }, []);

  const openPanels = useMemo(() => {
    const set = new Set<OverlayTab>();
    for (const tab of OVERLAY_TAB_ORDER) {
      if (exp.features[tab] && panelLayouts[tab].open) set.add(tab);
    }
    return set;
  }, [exp.features, panelLayouts]);

  const togglePanel = useCallback(
    (tab: OverlayTab) => {
      const willOpen = !panelLayouts[tab].open;
      updatePanelLayout(tab, { open: willOpen });
      if (willOpen) setFocusedPanel(tab);
    },
    [panelLayouts, updatePanelLayout],
  );

  /** Brings a tool up (opening it when closed) and in front of the others. */
  const showPanel = useCallback(
    (tab: OverlayTab) => {
      if (!panelLayouts[tab].open) updatePanelLayout(tab, { open: true });
      setFocusedPanel(tab);
    },
    [panelLayouts, updatePanelLayout],
  );

  /** Links from the panels open in the overlay's browser, or outside when it is off. */
  const openLink = useCallback(
    (url: string) => {
      if (!exp.features.browser) {
        void openUrl(url);
        return;
      }
      setBrowserRequest({ url, nonce: Date.now() });
      showPanel('browser');
    },
    [exp.features.browser, showPanel],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el?.closest('textarea, input, select, iframe')) return;
      const num = Number.parseInt(e.key, 10);
      const enabled = OVERLAY_TAB_ORDER.filter((tab) => exp.features[tab]);
      if (num >= 1 && num <= enabled.length) {
        togglePanel(enabled[num - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, exp.features, togglePanel]);

  const threadId = context?.threadId ?? running[0]?.threadId ?? '';
  const isCompact = exp.overlayDisplayMode === 'compact';
  const isFullscreen = !isCompact;

  useEffect(() => {
    if (!isCompact) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.onMoved(() => {
      void ipc.overlayPauseFollow(900);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void ipc.overlaySyncCompactFromWindow().then((geom) => {
          void saveExperimentalSettings({ overlayCompactGeom: geom });
        });
      }, 100);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unlisten?.();
    };
  }, [isCompact]);

  const renderPanelContent = (tab: OverlayTab): ReactNode => {
    if (!threadId) {
      return (
        <div className="game-overlay-panel-fill game-overlay-panel--disabled">
          <p className="game-overlay-empty-title">{t('overlay.noGameTitle')}</p>
          <p className="game-overlay-empty">{t('settings.experimental.noGameRunning')}</p>
        </div>
      );
    }
    if (!exp.features[tab]) {
      return (
        <div className="game-overlay-panel-fill game-overlay-panel--disabled">
          {t('overlay.featureOff')}
        </div>
      );
    }
    switch (tab) {
      case 'game':
        return (
          <OverlayGamePanel
            threadId={threadId}
            onOpenLink={openLink}
            onShowAchievements={() => showPanel('achievements')}
          />
        );
      case 'notes':
        return <OverlayNotesPanel threadId={threadId} enabled={exp.features.notes} />;
      case 'guides':
        return <OverlayGuidesPanel threadId={threadId} enabled={exp.features.guides} onOpenLink={openLink} />;
      case 'browser':
        return (
          <OverlayBrowserPanel
            enabled={exp.features.browser}
            homeUrl={exp.browserHomeUrl}
            boundsKey={`${panelLayouts.browser.x}-${panelLayouts.browser.y}-${panelLayouts.browser.w}-${panelLayouts.browser.h}`}
            request={browserRequest}
            showKey={showKey}
          />
        );
      case 'achievements':
        return (
          <OverlayAchievementsPanel threadId={threadId} enabled={exp.features.achievements} />
        );
      default:
        return null;
    }
  };

  const panelZ = (tab: OverlayTab) => {
    const order = OVERLAY_TAB_ORDER.filter((id) => openPanels.has(id));
    const base = 20;
    if (focusedPanel === tab) return base + order.length;
    const idx = order.indexOf(tab);
    return base + Math.max(0, idx);
  };

  return (
    <div
      className={`game-overlay-steam${isCompact ? ' game-overlay-steam--compact' : ''}`}
      style={
        isFullscreen
          ? ({ '--overlay-backdrop-opacity': String(exp.overlayBackdropOpacity) } as CSSProperties)
          : undefined
      }
    >
      {isFullscreen && (
        <button
          type="button"
          className="game-overlay-steam-backdrop"
          onClick={close}
          aria-label={t('overlay.backdropClose')}
          tabIndex={-1}
        />
      )}

      <OverlayBrandBar />

      <OverlayDock
        context={context}
        fallbackTitle={running.find((r) => r.threadId === threadId)?.title ?? null}
        anchor={anchor}
        running={running}
        threadId={threadId}
        features={exp.features}
        openPanels={openPanels}
        onTogglePanel={togglePanel}
        onSelectGame={(id) => void selectGame(id)}
        onCloseOverlay={close}
      />

      <div className="game-overlay-steam-panels">
        {OVERLAY_TAB_ORDER.map((tab) => {
          if (!openPanels.has(tab)) return null;
          const layout = clampPanelLayout(
            panelLayouts[tab],
            window.innerWidth,
            window.innerHeight,
          );
          return (
            <OverlayFloatPanel
              key={tab}
              title={t(OVERLAY_TAB_LABEL_KEYS[tab])}
              layout={layout}
              zIndex={panelZ(tab)}
              onFocus={() => setFocusedPanel(tab)}
              onClose={() => closePanel(tab)}
              onLayoutChange={(next) =>
                updatePanelLayout(tab, clampPanelLayout(next, window.innerWidth, window.innerHeight))
              }
            >
              {renderPanelContent(tab)}
            </OverlayFloatPanel>
          );
        })}
      </div>

      <footer className="game-overlay-steam-footer">
        <OverlayHotkeyBadge hotkey={exp.overlayHotkey} />
        <span>{t('overlay.footerToggle')}</span>
        <span className="game-overlay-steam-footer-sep">·</span>
        <kbd className="game-overlay-kbd">Esc</kbd>
        <span>{t('overlay.escClose')}</span>
        {isFullscreen && (
          <>
            <span className="game-overlay-steam-footer-sep">·</span>
            <span className="game-overlay-steam-footer-hint">{t('overlay.backdropClose')}</span>
          </>
        )}
      </footer>
    </div>
  );
}
