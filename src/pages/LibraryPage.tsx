import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LibraryCategoryBar } from '../components/library/LibraryCategoryBar';
import {
  LibraryCard,
  LibraryCoverTile,
  LibraryList,
  LibraryListRow,
} from '../components/library/LibraryGameViews';
import { Icon } from '../components/ui/Icon';
import { SearchBox } from '../components/ui/SearchBox';
import { ViewModeSwitch, useViewMode } from '../components/ui/ViewModeSwitch';
import { CollectionFolderCard } from '../components/library/CollectionFolderCard';
import { ContinuePlayingRow } from '../components/library/ContinuePlayingRow';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { useLibraryGameActions } from '../hooks/useLibraryGameActions';
import { useDownloadsByThread } from '../hooks/useDownloadsByThread';
import { UpdateCheckControl } from '../components/library/UpdateCheckControl';
import { useSkin } from '../hooks/useSkin';
import { useT } from '../lib/i18n';
import * as library from '../lib/library';
import {
  COLLECTIONS_CHANGE_EVENT,
  listCollections,
  listMemberships,
  type CollectionMembership,
  type LibraryCollection,
} from '../lib/collections';
import { rememberSearch } from '../lib/lastSearch';
import {
  readLibraryQuery,
  writeLibraryQuery,
  type LibraryQuery,
  type LibraryStatusFilter,
} from '../lib/libraryQuery';
import type { InstallStatus, LibraryGame, LibrarySort } from '../types/library';
import { statusKey } from '../types/library';
import type { SamCategory } from '../types/sam';

type StatusFilter = LibraryStatusFilter;

// Filters and sorts are declared as i18n keys instead of literal labels;
// the JSX wraps each `labelKey` in `t()` so a language switch re-renders
// them. Keeping these top-level keeps the array stable across renders.
const STATUS_FILTERS: { id: StatusFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'library.filter.all' },
  { id: 'installed', labelKey: 'library.filter.installed' },
  { id: 'not_installed', labelKey: 'library.filter.notInstalled' },
  { id: 'downloading', labelKey: 'library.filter.downloading' },
  { id: 'update_available', labelKey: 'library.filter.update' },
];

const SORTS: { id: LibrarySort; labelKey: string }[] = [
  { id: 'added', labelKey: 'library.sort.added' },
  { id: 'title', labelKey: 'library.sort.title' },
  { id: 'last_played', labelKey: 'library.sort.lastPlayed' },
  { id: 'playtime', labelKey: 'library.sort.playtime' },
  { id: 'size', labelKey: 'library.sort.size' },
  { id: 'rating', labelKey: 'library.sort.rating' },
];

/** Typing pause before the search reaches the URL and the query. */
const SEARCH_DEBOUNCE_MS = 200;

export function LibraryPage() {
  const { t } = useT();
  // Steam skin: LibraryLayout mounts the game-list panel (with its own
  // search) on the left, so this page hides its standalone search input.
  const steamMode = useSkin() === 'steam';
  // Filters live in the URL, so Back from a game and the nav link reopen
  // the same view (with its scroll, restored by the shell).
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => readLibraryQuery(searchParams), [searchParams]);
  const { category, status, sort } = query;
  const updateQuery = useCallback(
    (patch: Partial<LibraryQuery>) => {
      setSearchParams((prev) => writeLibraryQuery({ ...readLibraryQuery(prev), ...patch }), {
        replace: true,
      });
    },
    [setSearchParams],
  );
  useEffect(() => {
    const qs = searchParams.toString();
    rememberSearch('/library', qs ? `?${qs}` : '');
  }, [searchParams]);

  // The box updates at once; the URL follows when typing pauses.
  const [searchInput, setSearchInput] = useState(query.search);
  const pushedSearchRef = useRef(query.search);
  useEffect(() => {
    if (searchInput === pushedSearchRef.current) return;
    const timer = setTimeout(() => {
      pushedSearchRef.current = searchInput;
      updateQuery({ search: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, updateQuery]);
  useEffect(() => {
    if (query.search === pushedSearchRef.current) return;
    pushedSearchRef.current = query.search;
    setSearchInput(query.search);
  }, [query.search]);
  const search = query.search;

  const [items, setItems] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [memberships, setMemberships] = useState<CollectionMembership[]>([]);
  // Full library snapshot (all categories) feeding the folder mosaics.
  const [allGames, setAllGames] = useState<LibraryGame[]>([]);
  // Counts come from that snapshot: hidden until it arrives instead of showing zeros.
  const [countsReady, setCountsReady] = useState(false);
  const setCategory = useCallback(
    (next: SamCategory) => updateQuery({ category: next }),
    [updateQuery],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const games = await library.list({
        category,
        status,
        search: search.trim() || undefined,
        sort,
      });
      setItems(games);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [category, status, search, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Downloads, update checks, sessions and game pages write the library;
  // follow them in place (coalescing bursts) instead of going stale.
  const [libraryVersion, setLibraryVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = library.onLibraryChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reload();
        setLibraryVersion((v) => v + 1);
      }, 150);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [reload]);

  // Collections power the folder shelf; refresh whenever they change
  // anywhere in the app (picker modal, Steam sidebar, collection page).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [cols, mems, all] = await Promise.all([
          listCollections(),
          listMemberships(),
          library.list({}),
        ]);
        if (!cancelled) {
          setCollections(cols);
          setMemberships(mems);
          setAllGames(all);
          setCountsReady(true);
        }
      } catch (err) {
        console.warn('[collections] load failed', err);
      }
    };
    void load();
    const onChange = () => {
      void load();
    };
    window.addEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
    };
  }, [libraryVersion]);

  // One folder card per collection, scoped to the active category tab:
  // mosaic + count only consider members of this content type, and
  // collections without any member of it are hidden entirely (they show
  // up as soon as content of the type is associated).
  const collectionCards = useMemo(() => {
    if (collections.length === 0) return [];
    const byId = new Map(allGames.map((g) => [g.threadId, g]));
    return collections
      .map((collection) => ({
        collection,
        games: memberships
          .filter((m) => m.collectionId === collection.id)
          .map((m) => byId.get(m.threadId))
          .filter((g): g is LibraryGame => g !== undefined && g.category === category),
      }))
      .filter((card) => card.games.length > 0);
  }, [collections, memberships, allGames, category]);

  // "Continue playing" rail: 4 games the user actually touched recently. We
  // require ANY playtime so a game added but never opened doesn't pollute
  // the row, then sort by last-played-at desc. Only shown on the default
  // view (no search, no specific status filter) so it doesn't fight the
  // active filter visually.
  const continuePlaying = useMemo(() => {
    if (category !== 'games') return [];
    if (search.trim() || (status !== 'all' && status !== 'installed')) return [];
    return items
      .filter((g) => g.lastPlayedAt && (g.totalPlaytimeSeconds ?? 0) > 0)
      .sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''))
      .slice(0, 4);
  }, [items, search, status, category]);

  const { openLibraryContextMenu, playOrStop } = useLibraryGameActions({
    onReload: reload,
  });
  const downloadsByThread = useDownloadsByThread();
  const [view, setView] = useViewMode('library');

  // Chip counts follow the category tab, whatever else is filtered.
  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: 0,
      installed: 0,
      not_installed: 0,
      downloading: 0,
      extracting: 0,
      update_available: 0,
      error: 0,
    };
    for (const g of allGames) {
      if (g.category !== category) continue;
      out.all += 1;
      out[g.installStatus] += 1;
    }
    out.downloading += out.extracting;
    return out;
  }, [allGames, category]);

  const itemProps = (g: LibraryGame) => ({
    game: g,
    onPrimaryAction: playOrStop,
    onContextMenu: openLibraryContextMenu,
    download: downloadsByThread.get(g.threadId),
  });

  return (
    <div className="lib-page">
      <header className="lib-head">
        <h1 className="lib-head-title">{t('library.title')}</h1>
        {countsReady && (
          <span className="lib-head-stats">
            {counts.all === 1
              ? t('library.stats.game', { count: counts.all })
              : t('library.stats.games', { count: counts.all })}
            {' · '}
            {t('library.stats.installed', { count: counts.installed + counts.update_available })}
          </span>
        )}
        <span className="lib-head-spacer" />
        {/* Shared with News; runs in the background too. Results arrive as
            library changes, which this page already follows. */}
        <UpdateCheckControl onShowUpdates={() => updateQuery({ status: 'update_available' })} />
      </header>

      <LibraryCategoryBar category={category} onCategory={setCategory} />

      <div className="ui-toolbar lib-toolbar">
        {/* In Steam mode the search lives in the left game-list panel. */}
        {!steamMode && (
          <SearchBox value={searchInput} onChange={setSearchInput} placeholder={t('library.search')} shortcut />
        )}
        <div className="ui-chips" role="group" aria-label={t('library.filter.label')}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="ui-chip"
              aria-pressed={status === f.id}
              onClick={() => updateQuery({ status: f.id })}
            >
              {t(f.labelKey)}
              {countsReady && <span className="ui-chip-count">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
        <span className="ui-toolbar-spacer" />
        <select
          className="ui-select"
          value={sort}
          aria-label={t('library.sort.label')}
          onChange={(e) => updateQuery({ sort: e.target.value as LibrarySort })}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
        <ViewModeSwitch value={view} onChange={setView} />
      </div>

      {error && <div className="store-error">{error}</div>}

      {/* Folder shelf — real folders, like Steam collections: click opens
          the collection page. Hidden while searching to keep results focused. */}
      {collectionCards.length > 0 && !search.trim() && (
        <section className="lib-section">
          <div className="ui-section-head">
            <h2 className="ui-section-title">{t('library.collections.manageTitle')}</h2>
          </div>
          <div className="collection-folder-grid">
            {collectionCards.map(({ collection, games }) => (
              <CollectionFolderCard key={collection.id} collection={collection} games={games} />
            ))}
          </div>
        </section>
      )}

      {loading && items.length === 0 ? (
        <GameCardGridSkeleton count={8} />
      ) : items.length === 0 ? (
        <EmptyState
          status={status}
          category={category}
          search={search.trim()}
          onClear={() => {
            setSearchInput('');
            pushedSearchRef.current = '';
            updateQuery({ search: '', status: 'all' });
          }}
        />
      ) : (
        <>
          {continuePlaying.length > 0 && (
            <ContinuePlayingRow
              games={continuePlaying}
              onPlay={playOrStop}
              onContextMenu={openLibraryContextMenu}
            />
          )}

          <section className="lib-section">
            {(continuePlaying.length > 0 || collectionCards.length > 0) && (
              <div className="ui-section-head">
                <h2 className="ui-section-title">{t('library.section.all')}</h2>
              </div>
            )}
            {view === 'list' ? (
              <LibraryList
                games={items}
                sort={sort}
                onSort={(next) => updateQuery({ sort: next })}
                renderRow={(g) => <LibraryListRow key={g.threadId} {...itemProps(g)} />}
              />
            ) : (
              <div className={view === 'covers' ? 'lib-grid lib-grid--covers' : 'lib-grid'}>
                {items.map((g) =>
                  view === 'covers' ? (
                    <LibraryCoverTile key={g.threadId} {...itemProps(g)} />
                  ) : (
                    <LibraryCard key={g.threadId} {...itemProps(g)} />
                  ),
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState({
  status,
  category,
  search,
  onClear,
}: {
  status: StatusFilter;
  category: SamCategory;
  search: string;
  onClear: () => void;
}) {
  const { t } = useT();
  // Nothing matched the search: say so, instead of "your library is empty".
  if (search) {
    return (
      <div className="ui-empty">
        <Icon name="search" size={32} />
        <p className="ui-empty-title">{t('library.empty.search', { query: search })}</p>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onClear}>
          {t('library.empty.clearSearch')}
        </button>
      </div>
    );
  }
  if (status === 'all') {
    const catHint = t(`library.empty.${category}`);
    return (
      <div className="ui-empty">
        <Icon name="library" size={32} />
        <p className="ui-empty-title">
          {catHint !== `library.empty.${category}` ? catHint : t('library.empty.title')}
        </p>
        <p className="ui-empty-text">{t('library.empty.hint')}</p>
        <Link to="/store" className="ui-btn ui-btn--primary">
          {t('library.empty.openStore')}
        </Link>
      </div>
    );
  }
  return (
    <div className="ui-empty">
      <Icon name="filter" size={32} />
      <p className="ui-empty-title">
        {t('library.empty.filter', { status: t(statusKey(status as InstallStatus)) })}
      </p>
      <button type="button" className="ui-btn ui-btn--secondary" onClick={onClear}>
        {t('library.empty.showAll')}
      </button>
    </div>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
