import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useContextMenu } from '../contextMenu';
import { parseSamCategory, SAM_CATEGORIES } from '../../constants/samCategories';
import { useLibraryGameActions } from '../../hooks/useLibraryGameActions';
import { buildCollectionMenu } from '../../lib/collectionActions';
import { useT } from '../../lib/i18n';
import * as library from '../../lib/library';
import {
  COLLECTIONS_CHANGE_EVENT,
  listCollections,
  listMemberships,
  type CollectionMembership,
  type LibraryCollection,
} from '../../lib/collections';
import type { LibraryGame } from '../../types/library';
import type { SamCategory } from '../../types/sam';

const UNCATEGORIZED = 'uncat' as const;
type GroupKey = number | typeof UNCATEGORIZED;

/**
 * Steam-library-style left panel: a search box on top and the game list
 * below (alphabetical), one compact row per game — installed games read
 * brighter and the routed game gets the accent slab, like Steam.
 * When the user has collections, the list is grouped into collapsible
 * Steam-collection-style sections (game can appear in several) plus an
 * "uncategorized" tail; group headers expose rename/delete via
 * right-click. Self-sufficient: loads its own data so it can stay visible
 * across the library home AND game detail routes (mounted by
 * LibraryLayout when the Steam skin is active). The list follows the
 * category tabs (`?cat=` on /library); the search filters the panel only,
 * mirroring Steam.
 */
export function SteamLibrarySidebar() {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { openContextMenu } = useContextMenu();
  const detailMatch = useMatch('/library/game/:threadId');
  const activeThreadId = detailMatch?.params.threadId ?? null;

  // Follow the category tabs. On detail routes the param can be absent
  // (game opened from the grid), so keep the last known category instead
  // of snapping back to Games.
  const isHome = detailMatch === null;
  const catParam = new URLSearchParams(location.search).get('cat');
  const [category, setCategory] = useState<SamCategory>(() => parseSamCategory(catParam));

  useEffect(() => {
    if (isHome || catParam !== null) {
      setCategory(parseSamCategory(catParam));
    }
  }, [isHome, catParam]);

  const [games, setGames] = useState<LibraryGame[]>([]);
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [memberships, setMemberships] = useState<CollectionMembership[]>([]);
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    try {
      const [list, cols, mems] = await Promise.all([
        library.list({ category }),
        listCollections(),
        listMemberships(),
      ]);
      setGames(list);
      setCollections(cols);
      setMemberships(mems);
    } catch {
      // Best-effort: the main pages already surface library errors.
    }
  }, [category]);

  // Refresh on category switches and on every route change inside the
  // library, so installs/removals done from a detail page show up.
  useEffect(() => {
    void reload();
  }, [reload, location.pathname]);

  // Live-refresh when collections/memberships change anywhere in the app
  // (picker modal, other views).
  useEffect(() => {
    const onChange = () => {
      void reload();
    };
    window.addEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
  }, [reload]);

  const { openLibraryContextMenu } = useLibraryGameActions({ onReload: reload });

  const visible = useMemo(() => {
    const sorted = [...games].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    );
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((g) => g.title.toLowerCase().includes(q));
  }, [games, search]);

  // Collection groups over the visible (category + search filtered) rows.
  // Groups with no member of the current category/search are hidden — a
  // collection only shows where it has matching content. Null (flat list)
  // when nothing groups.
  const groups = useMemo(() => {
    if (collections.length === 0) return null;
    const memberSets = new Map<number, Set<string>>();
    for (const m of memberships) {
      let set = memberSets.get(m.collectionId);
      if (!set) {
        set = new Set();
        memberSets.set(m.collectionId, set);
      }
      set.add(m.threadId);
    }
    const grouped = collections
      .map((collection) => ({
        collection,
        games: visible.filter((g) => memberSets.get(collection.id)?.has(g.threadId)),
      }))
      .filter((group) => group.games.length > 0);
    if (grouped.length === 0) return null;
    const inAny = new Set(memberships.map((m) => m.threadId));
    return {
      collections: grouped,
      uncategorized: visible.filter((g) => !inAny.has(g.threadId)),
    };
  }, [collections, memberships, visible]);

  // Head shows the active category (same labels as the tabs).
  const categoryMeta = SAM_CATEGORIES.find((c) => c.id === category);
  const categoryLabel =
    categoryMeta?.literal ?? (categoryMeta?.labelKey ? t(categoryMeta.labelKey) : category);

  function toggleGroup(key: GroupKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onCollectionContextMenu(e: React.MouseEvent, col: LibraryCollection) {
    openContextMenu(e, buildCollectionMenu(col, t));
  }

  function renderRow(g: LibraryGame) {
    const isActive = String(g.threadId) === activeThreadId;
    const installed = g.installStatus === 'installed';
    return (
      <li key={g.threadId}>
        <button
          type="button"
          className={`steam-library-row${installed ? ' steam-library-row--installed' : ''}${
            isActive ? ' steam-library-row--active' : ''
          }`}
          onClick={() =>
            navigate(
              // Carry the category so the panel keeps its context on the
              // detail route (games = default, no param — same convention
              // as LibraryPage).
              `/library/game/${g.threadId}${category !== 'games' ? `?cat=${category}` : ''}`,
            )
          }
          onContextMenu={(e) => openLibraryContextMenu(e, g)}
          title={g.title}
        >
          {g.thumbnailUrl ? (
            <img src={g.thumbnailUrl} alt="" className="steam-library-row-thumb" loading="lazy" />
          ) : (
            <span className="steam-library-row-thumb steam-library-row-thumb--empty" />
          )}
          <span className="steam-library-row-title">{g.title}</span>
        </button>
      </li>
    );
  }

  function renderGroup(
    key: GroupKey,
    label: string,
    groupGames: LibraryGame[],
    col?: LibraryCollection,
  ) {
    const isCollapsed = collapsed.has(key);
    return (
      <section
        key={key}
        className={`steam-library-group${isCollapsed ? ' steam-library-group--collapsed' : ''}`}
      >
        <button
          type="button"
          className="steam-library-group-head"
          onClick={() => toggleGroup(key)}
          onContextMenu={col ? (e) => onCollectionContextMenu(e, col) : undefined}
          title={label}
        >
          <span className="steam-library-group-chevron" aria-hidden />
          <span className="steam-library-group-name">{label}</span>
          <span className="steam-library-group-count">({groupGames.length})</span>
        </button>
        {!isCollapsed && (
          <ul className="steam-library-group-list">{groupGames.map((g) => renderRow(g))}</ul>
        )}
      </section>
    );
  }

  return (
    <aside className="steam-library-sidebar">
      <div className="steam-library-search-wrap">
        <span className="steam-library-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          className="steam-library-search"
          placeholder={t('library.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="steam-library-side-head">
        {categoryLabel} ({visible.length})
      </div>

      {groups ? (
        <div className="steam-library-list">
          {groups.collections.map(({ collection, games: groupGames }) =>
            renderGroup(collection.id, collection.name, groupGames, collection),
          )}
          {renderGroup(UNCATEGORIZED, t('library.collections.uncategorized'), groups.uncategorized)}
        </div>
      ) : (
        <ul className="steam-library-list">{visible.map((g) => renderRow(g))}</ul>
      )}
    </aside>
  );
}
