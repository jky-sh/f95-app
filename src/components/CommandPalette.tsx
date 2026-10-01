import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as library from '../lib/library';
import { useT } from '../lib/i18n';
import { useSectionHref } from '../lib/lastSearch';
import { storeLink } from '../lib/storeQuery';
import { openBigPicture } from '../lib/bigPicture';
import { statusKey, type LibraryGame } from '../types/library';
import { LibraryCover } from './library/LibraryCover';
import { Icon, type IconName } from './ui/Icon';

const OPEN_EVENT = 'f95:open-command-palette';

/** Opens the quick search from anywhere (sidebar button, Steam top bar). */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Group = 'recent' | 'library' | 'store' | 'pages';

interface Entry {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  icon?: IconName;
  game?: LibraryGame;
  to: string;
  /** Instead of navigating to `to`. */
  run?: () => void;
}

const GROUP_ORDER: Group[] = ['recent', 'library', 'store', 'pages'];
const MAX_GAMES = 6;
const MAX_RECENT = 5;

const PAGES: { to: string; labelKey: string; icon: IconName }[] = [
  { to: '/store', labelKey: 'nav.store', icon: 'store' },
  { to: '/library', labelKey: 'nav.library', icon: 'library' },
  { to: '/downloads', labelKey: 'nav.downloads', icon: 'download' },
  { to: '/news', labelKey: 'nav.news', icon: 'news' },
  { to: '/friends', labelKey: 'nav.friends', icon: 'users' },
  { to: '/profile', labelKey: 'nav.profile', icon: 'user' },
  { to: '/alerts', labelKey: 'nav.alerts', icon: 'bell' },
  { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
];

const SETTINGS_SECTIONS: { id: string; icon: IconName }[] = [
  { id: 'appearance', icon: 'palette' },
  { id: 'storage', icon: 'hardDrive' },
  { id: 'downloads', icon: 'download' },
  { id: 'hosts', icon: 'server' },
  { id: 'system', icon: 'monitor' },
  { id: 'experimental', icon: 'flask' },
  { id: 'about', icon: 'info' },
  { id: 'account', icon: 'user' },
];

/** Lowercase without accents, so "configuracoes" finds "Configurações". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function matches(text: string, tokens: string[]): boolean {
  const hay = fold(text);
  return tokens.every((tok) => hay.includes(tok));
}

/**
 * Ctrl+K quick search: jump to a library game, search the store, or open a
 * page or a settings section. Mounted once in the app shell.
 */
export function CommandPalette() {
  const { t } = useT();
  const navigate = useNavigate();
  const storeHref = useSectionHref('/store');
  const libraryHref = useSectionHref('/library');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [active, setActiveState] = useState(0);
  // Keys can arrive faster than renders: handlers read the latest index here.
  const activeRef = useRef(0);
  const setActive = useCallback((next: number | ((prev: number) => number)) => {
    const value = typeof next === 'function' ? next(activeRef.current) : next;
    activeRef.current = value;
    setActiveState(value);
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    setOpen(true);
  }, [setActive]);

  const close = useCallback(() => {
    setOpen(false);
    returnFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [open, show, close]);

  // A fresh snapshot each time it opens: cheap, and never stale.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    library
      .list({ sort: 'last_played' })
      .then((all) => {
        if (!cancelled) setGames(all);
      })
      .catch((err) => console.warn('[palette] library load failed', err));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const entries = useMemo((): Entry[] => {
    const q = query.trim();
    const tokens = fold(q).split(/\s+/).filter(Boolean);
    const out: Entry[] = [];
    const gameEntry = (g: LibraryGame, group: Group): Entry => ({
      id: `${group}-${g.threadId}`,
      group,
      label: g.title,
      hint: [t(statusKey(g.installStatus)), g.currentVersion].filter(Boolean).join(' · '),
      game: g,
      to: `/library/game/${g.threadId}`,
    });

    if (tokens.length === 0) {
      for (const g of games.filter((x) => x.lastPlayedAt).slice(0, MAX_RECENT)) out.push(gameEntry(g, 'recent'));
    } else {
      const hits = games.filter((g) => matches(g.title, tokens));
      // Titles that start with the query first, then the rest in play order.
      const head = fold(q);
      hits.sort((a, b) => Number(fold(b.title).startsWith(head)) - Number(fold(a.title).startsWith(head)));
      for (const g of hits.slice(0, MAX_GAMES)) out.push(gameEntry(g, 'library'));
      out.push({
        id: 'store-title',
        group: 'store',
        label: t('palette.store.title', { query: q }),
        icon: 'search',
        to: storeLink({ search: q }),
      });
      out.push({
        id: 'store-dev',
        group: 'store',
        label: t('palette.store.dev', { query: q }),
        icon: 'user',
        to: storeLink({ creator: q, searchIn: 'creator' }),
      });
    }

    const settingsLabel = t('nav.settings');
    const pages: Entry[] = [
      ...PAGES.map((p) => ({
        id: `page-${p.to}`,
        group: 'pages' as const,
        label: t(p.labelKey),
        icon: p.icon,
        to: p.to === '/store' ? storeHref : p.to === '/library' ? libraryHref : p.to,
      })),
      {
        id: 'big-picture',
        group: 'pages',
        label: t('bp.open'),
        icon: 'bigPicture',
        to: '',
        run: () => openBigPicture(null),
      },
      ...SETTINGS_SECTIONS.map((s) => ({
        id: `settings-${s.id}`,
        group: 'pages' as const,
        label: `${settingsLabel} › ${t(`settings.nav.${s.id}`)}`,
        icon: s.icon,
        to: s.id === 'appearance' ? '/settings' : `/settings?section=${s.id}`,
      })),
    ];
    // Without a query the list stays short: the main pages and Big Picture.
    out.push(...(tokens.length ? pages.filter((p) => matches(p.label, tokens)) : pages.slice(0, PAGES.length + 1)));
    return out;
  }, [games, query, t, storeHref, libraryHref]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, entries.length - 1)));
  }, [entries.length, setActive]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function run(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    if (entry.run) entry.run();
    else navigate(entry.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (entries.length ? (i + 1) % entries.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (entries.length ? (i - 1 + entries.length) % entries.length : 0));
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      setActive(Math.max(0, entries.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(entries[activeRef.current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Modal: focus stays in the search field.
      e.preventDefault();
    }
  }

  if (!open) return null;

  const groupTitle: Record<Group, string> = {
    recent: t('palette.group.recent'),
    library: t('palette.group.library'),
    store: t('palette.group.store'),
    pages: t('palette.group.pages'),
  };
  const activeEntry = entries[active];
  let index = -1;

  return (
    <div className="cmdk-backdrop" onMouseDown={close}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdk-input-row">
          <Icon name="search" size={16} className="cmdk-input-icon" />
          <input
            autoFocus
            className="cmdk-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={activeEntry ? `cmdk-${activeEntry.id}` : undefined}
            placeholder={t('palette.placeholder')}
            value={query}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef} aria-label={t('palette.title')}>
          {GROUP_ORDER.map((group) => {
            const items = entries.filter((e) => e.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} role="group" aria-labelledby={`cmdk-group-${group}`}>
                <div className="cmdk-group-title" id={`cmdk-group-${group}`}>
                  {groupTitle[group]}
                </div>
                {items.map((entry) => {
                  index += 1;
                  const i = index;
                  return (
                    <div
                      key={entry.id}
                      id={`cmdk-${entry.id}`}
                      data-index={i}
                      role="option"
                      aria-selected={i === active}
                      className="cmdk-item"
                      onMouseMove={() => i !== active && setActive(i)}
                      onClick={() => run(entry)}
                    >
                      {entry.game ? (
                        <span className="cmdk-item-art">
                          <LibraryCover url={entry.game.thumbnailUrl} title={entry.game.title} quality="preview" />
                        </span>
                      ) : (
                        <span className="cmdk-item-icon">
                          <Icon name={entry.icon ?? 'chevronRight'} size={16} />
                        </span>
                      )}
                      <span className="cmdk-item-label">{entry.label}</span>
                      {entry.hint && <span className="cmdk-item-hint">{entry.hint}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {entries.length === 0 && <div className="cmdk-empty">{t('palette.empty')}</div>}
        </div>

        <div className="cmdk-foot">{t('palette.hint')}</div>
      </div>
    </div>
  );
}
