import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LibraryCategoryBar } from '../components/library/LibraryCategoryBar';
import { LibraryCard } from '../components/library/LibraryCard';
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

  const stats = useMemo(
    () => ({
      total: items.length,
      installed: items.filter((g) => g.installStatus === 'installed').length,
    }),
    [items],
  );

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

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>{t('library.title')}</h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <div style={statsStyle}>
            {stats.total === 1 ? t('library.stats.game', { count: stats.total }) : t('library.stats.games', { count: stats.total })}
            {' · '}
            {t('library.stats.installed', { count: stats.installed })}
          </div>
          {/* Shared with News; runs in the background too. Results arrive as
              library changes, which this page already follows. */}
          <UpdateCheckControl
            buttonStyle={updateBtn}
            onShowUpdates={() => updateQuery({ status: 'update_available' })}
          />
        </div>
      </header>

      <LibraryCategoryBar category={category} onCategory={setCategory} />

      <div style={controlsStyle}>
        {/* In Steam mode the search lives in the left game-list panel. */}
        {!steamMode && (
          <input
            type="search"
            value={searchInput}
            placeholder={t('library.search')}
            onChange={(e) => setSearchInput(e.target.value)}
            style={searchInputStyle}
          />
        )}

        <select
          value={sort}
          onChange={(e) => updateQuery({ sort: e.target.value as LibrarySort })}
          style={steamMode ? { ...selectStyle, marginLeft: 'auto' } : selectStyle}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <div style={pillsRow}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => updateQuery({ status: f.id })}
            style={{
              ...pillBtn,
              ...(status === f.id ? pillBtnActive : {}),
            }}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {/* Folder shelf — real folders, like Steam collections: click opens
          the collection page. Hidden while searching to keep results focused. */}
      {collectionCards.length > 0 && !search.trim() && (
        <>
          <h2 style={allGamesHeadingStyle}>{t('library.collections.manageTitle')}</h2>
          <div className="collection-folder-grid">
            {collectionCards.map(({ collection, games }) => (
              <CollectionFolderCard key={collection.id} collection={collection} games={games} />
            ))}
          </div>
        </>
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

          {(continuePlaying.length > 0 || collectionCards.length > 0) && (
            <h2 style={allGamesHeadingStyle}>{t('library.section.all')}</h2>
          )}

          <div style={gridStyle}>
            {items.map((g) => (
              <LibraryCard
                key={g.threadId}
                game={g}
                onPrimaryAction={playOrStop}
                onContextMenu={openLibraryContextMenu}
                download={downloadsByThread.get(g.threadId)}
              />
            ))}
          </div>
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
      <div style={emptyBox}>
        <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 14 }}>
          {t('library.empty.search', { query: search })}
        </p>
        <button type="button" onClick={onClear} style={{ ...pillBtn, marginTop: 12 }}>
          {t('library.empty.clearSearch')}
        </button>
      </div>
    );
  }
  if (status === 'all') {
    const catHint = t(`library.empty.${category}`);
    return (
      <div style={emptyBox}>
        <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 14 }}>
          {catHint !== `library.empty.${category}` ? catHint : t('library.empty.title')}
        </p>
        <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>
          {t('library.empty.hint')}
        </p>
      </div>
    );
  }
  return (
    <div style={emptyBox}>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
        {t('library.empty.filter', { status: t(statusKey(status as InstallStatus)) })}
      </p>
    </div>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

const pageStyle: React.CSSProperties = {
  padding: '20px 24px 40px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-faint)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text-primary)',
  margin: 0,
};

const statsStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
};

const updateBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  marginBottom: 12,
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text-secondary)',
  fontSize: 13,
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  padding: '7px 10px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text-secondary)',
  fontSize: 13,
  cursor: 'pointer',
};

const pillsRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  marginBottom: 16,
};

const pillBtn: React.CSSProperties = {
  padding: '4px 12px',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
};

const pillBtnActive: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--text-primary)',
  borderColor: 'var(--accent)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 14,
};

const emptyBox: React.CSSProperties = {
  textAlign: 'center',
  padding: '60px 20px',
  color: 'var(--text-muted)',
  fontSize: 14,
};

const allGamesHeadingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  margin: '0 0 14px',
};

const errorBox: React.CSSProperties = {
  background: 'var(--status-danger-bg)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--status-danger-text)',
  padding: '12px 16px',
  borderRadius: 4,
  marginBottom: 16,
  fontSize: 13,
};
