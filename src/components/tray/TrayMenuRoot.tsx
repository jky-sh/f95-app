import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LocaleProvider, useT } from '../../lib/i18n';
import * as library from '../../lib/library';
import {
  emitTrayMenuAction,
  getLastTrayMenuOpen,
  hideTrayMenu,
  MAX_RECENT_GAMES,
  MENU_WIDTH,
  resizeTrayMenuTo,
  subscribeTrayMenuOpen,
  type TrayMenuAction,
} from '../../lib/trayMenu';
import type { LibraryGame } from '../../types/library';
import '../../styles/tray-menu.css';

interface NavItem {
  id: Exclude<TrayMenuAction, 'open-game' | 'quit' | 'library'>;
  labelKey: string;
}

const TOP_ITEMS: NavItem[] = [{ id: 'show', labelKey: 'tray.show' }];

const BOTTOM_ITEMS: NavItem[] = [
  { id: 'downloads', labelKey: 'tray.downloads' },
  { id: 'settings', labelKey: 'tray.settings' },
  { id: 'changelog', labelKey: 'tray.changelog' },
  { id: 'check-updates', labelKey: 'tray.checkUpdates' },
];

function TrayMenuPanel() {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [recent, setRecent] = useState<LibraryGame[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('tray-menu-window');
    document.body.classList.add('tray-menu-window');
    return () => {
      document.documentElement.classList.remove('tray-menu-window');
      document.body.classList.remove('tray-menu-window');
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void hideTrayMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) void hideTrayMenu();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const loadRecent = () => {
      setLoadingRecent(true);
      void library
        .listRecentPlayed(MAX_RECENT_GAMES)
        .then((games) => {
          if (!cancelled) setRecent(games);
        })
        .catch((err) => {
          console.warn('[tray-menu] recent games failed', err);
          if (!cancelled) setRecent([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingRecent(false);
        });
    };

    void subscribeTrayMenuOpen(() => {
      loadRecent();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    if (getLastTrayMenuOpen()) loadRecent();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Window opens oversized; shrink exactly to the panel once content is ready.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const sync = () => {
      const rect = el.getBoundingClientRect();
      const w = MENU_WIDTH;
      const h = Math.ceil(rect.height);
      if (h > 0) void resizeTrayMenuTo(w, h);
    };

    const raf = window.requestAnimationFrame(sync);
    const t1 = window.setTimeout(sync, 32);
    const t2 = window.setTimeout(sync, 120);
    const t3 = window.setTimeout(sync, 320);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [recent, loadingRecent, t]);

  return (
    <div className="tray-menu-root">
      <div
        ref={panelRef}
        className="tray-menu-panel"
        style={{ width: MENU_WIDTH }}
        role="menu"
        aria-label={t('tray.menu.label')}
      >
        {TOP_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="tray-menu-item"
            onClick={() => void emitTrayMenuAction(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}

        <div className="tray-menu-sep" role="separator" />

        <button
          type="button"
          role="menuitem"
          className="tray-menu-item"
          onClick={() => void emitTrayMenuAction('library')}
        >
          {t('tray.library')}
        </button>

        <div className="tray-menu-section-label">{t('tray.recentGames')}</div>

        {loadingRecent && recent.length === 0 ? (
          <div className="tray-menu-empty">{t('tray.recent.loading')}</div>
        ) : recent.length === 0 ? (
          <div className="tray-menu-empty">{t('tray.recent.empty')}</div>
        ) : (
          recent.map((game) => (
            <button
              key={game.threadId}
              type="button"
              role="menuitem"
              className="tray-menu-game"
              title={game.title}
              onClick={() => void emitTrayMenuAction('open-game', { threadId: game.threadId })}
            >
              {game.thumbnailUrl ? (
                <img className="tray-menu-game-thumb" src={game.thumbnailUrl} alt="" />
              ) : (
                <span className="tray-menu-game-thumb tray-menu-game-thumb--fallback" aria-hidden>
                  {game.title.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="tray-menu-game-title">{game.title}</span>
            </button>
          ))
        )}

        <div className="tray-menu-sep" role="separator" />

        {BOTTOM_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="tray-menu-item"
            onClick={() => void emitTrayMenuAction(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}

        <div className="tray-menu-sep" role="separator" />

        <button
          type="button"
          role="menuitem"
          className="tray-menu-item tray-menu-item--danger"
          onClick={() => void emitTrayMenuAction('quit')}
        >
          {t('tray.quit')}
        </button>
      </div>
    </div>
  );
}

/** Custom tray context menu (dedicated Tauri window). */
export function TrayMenuRoot() {
  return (
    <LocaleProvider>
      <TrayMenuPanel />
    </LocaleProvider>
  );
}
