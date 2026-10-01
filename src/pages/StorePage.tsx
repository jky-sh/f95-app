import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FilterSidebar,
  dateRangeLabel,
  type StoreSearchMode,
} from '../components/store/FilterSidebar';
import { StoreCoverTile, StoreList, StoreListRow } from '../components/store/StoreGameViews';
import { Icon } from '../components/ui/Icon';
import { ViewModeSwitch, useViewMode } from '../components/ui/ViewModeSwitch';
import { usePrefixCatalog } from '../contexts/PrefixCatalogContext';
import { GameCard } from '../components/store/GameCard';
import { FeaturedHero } from '../components/store/FeaturedHero';
import { StorePagination } from '../components/store/StorePagination';
import { LoadingState } from '../components/ui/LoadingState';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { useSamList } from '../hooks/useSamList';
import { useLibraryIndex } from '../hooks/useLibraryIndex';
import { useNow } from '../hooks/useNow';
import { useStoreSettings } from '../contexts/StoreSettings';
import { useTagCatalog } from '../contexts/TagCatalogContext';
import { OfflineGate } from '../components/OfflineGate';
import { useT } from '../lib/i18n';
import { describeIpcError } from '../lib/ipcError';
import {
  readStoreQuery,
  rememberStoreSearch,
  writeStoreQuery,
  type StoreQuery,
} from '../lib/storeQuery';
import type { PrefixFilterMode, SamCategory, SamSort, SamTag, SamTagMode } from '../types/sam';

/** Typing pause before a search reaches the URL and F95. */
const SEARCH_DEBOUNCE_MS = 350;

const SORTS: { id: SamSort; labelKey: string }[] = [
  { id: 'date', labelKey: 'filter.sort.date' },
  { id: 'likes', labelKey: 'filter.sort.likes' },
  { id: 'views', labelKey: 'filter.sort.views' },
  { id: 'rating', labelKey: 'filter.sort.rating' },
  { id: 'title', labelKey: 'filter.sort.name' },
];

export function StorePage() {
  const { t } = useT();
  const { settings: storeSettings, loading: storeSettingsLoading } = useStoreSettings();
  const infiniteScroll = storeSettings.scrollMode === 'infinite';
  const { resolve: resolveTag } = useTagCatalog();
  const { resolve: resolvePrefix } = usePrefixCatalog();
  const [view, setView] = useViewMode('store');
  const libraryIndex = useLibraryIndex();
  const now = useNow();

  // Filters live in the URL, so Back from a game, the nav link or a reload
  // reopen the same list.
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readStoreQuery(params), [params]);
  const { category, sort, prefixFilter, tagMode } = query;

  const updateQuery = useCallback(
    (patch: Partial<StoreQuery>) => {
      // Any filter change starts over at page 1 unless the patch says otherwise.
      setParams((prev) => writeStoreQuery({ ...readStoreQuery(prev), page: 1, ...patch }), {
        replace: true,
      });
    },
    [setParams],
  );

  useEffect(() => {
    const qs = params.toString();
    rememberStoreSearch(qs ? `?${qs}` : '');
  }, [params]);

  // One box searches titles or developers. It updates at once; the URL (and
  // the list) follow when typing pauses.
  const searchMode = query.searchIn;
  const urlSearch = searchMode === 'creator' ? query.creator : query.search;
  const [searchInput, setSearchInput] = useState(urlSearch);
  const pushedSearchRef = useRef(urlSearch);
  useEffect(() => {
    if (searchInput === pushedSearchRef.current) return;
    const timer = setTimeout(() => {
      pushedSearchRef.current = searchInput;
      updateQuery(searchMode === 'creator' ? { creator: searchInput } : { search: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, searchMode, updateQuery]);
  // Search changed from outside the box (a link, or the URL of a Back).
  useEffect(() => {
    if (urlSearch === pushedSearchRef.current) return;
    pushedSearchRef.current = urlSearch;
    setSearchInput(urlSearch);
  }, [urlSearch]);

  /** Switching title ⇄ developer carries the typed text over. */
  const changeSearchMode = useCallback(
    (mode: StoreSearchMode) => {
      if (mode === searchMode) return;
      pushedSearchRef.current = searchInput;
      updateQuery({
        searchIn: mode,
        search: mode === 'title' ? searchInput : '',
        creator: mode === 'creator' ? searchInput : '',
      });
    },
    [searchMode, searchInput, updateQuery],
  );

  const selectedTags = useMemo<SamTag[]>(
    () => query.tagIds.map((id) => ({ id, name: resolveTag(id) })),
    [query.tagIds, resolveTag],
  );
  const excludedTags = useMemo<SamTag[]>(
    () => query.excludedTagIds.map((id) => ({ id, name: resolveTag(id) })),
    [query.excludedTagIds, resolveTag],
  );

  const includePrefixes = useMemo(
    () =>
      Object.entries(prefixFilter)
        .filter(([, mode]) => mode === 'include')
        .map(([id]) => Number(id)),
    [prefixFilter],
  );
  const excludePrefixes = useMemo(
    () =>
      Object.entries(prefixFilter)
        .filter(([, mode]) => mode === 'exclude')
        .map(([id]) => Number(id)),
    [prefixFilter],
  );

  const search = query.search.trim();
  const creator = query.creator.trim();
  const hasActiveFilters =
    searchInput.trim().length > 0 ||
    query.date > 0 ||
    includePrefixes.length > 0 ||
    excludePrefixes.length > 0 ||
    selectedTags.length > 0 ||
    excludedTags.length > 0;

  const { items, page, totalPages, totalRows, loading, error, hasMore, loadMore, reload, retry } =
    useSamList(
      {
        category,
        sort,
        search: search || undefined,
        creator: creator || undefined,
        date: query.date || undefined,
        prefixes: includePrefixes.length ? includePrefixes : undefined,
        noprefixes: excludePrefixes.length ? excludePrefixes : undefined,
        tags: query.tagIds.length ? query.tagIds : undefined,
        notags: query.excludedTagIds.length ? query.excludedTagIds : undefined,
        tagtype: query.tagIds.length ? tagMode : undefined,
      },
      {
        mode: infiniteScroll ? 'infinite' : 'paged',
        page: query.page,
        // Wait for the saved scroll mode, or paged users fetch page 1 twice.
        enabled: !storeSettingsLoading,
      },
    );

  // The sentinel unmounts while a page failed; re-attach once it is back.
  const errored = error != null;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!infiniteScroll || errored) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadMore();
        }
      },
      { rootMargin: '300px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [infiniteScroll, errored, loadMore]);

  // The hero only makes sense on the plain "latest updates" list.
  const showFeatured =
    sort === 'date' &&
    !search &&
    !creator &&
    query.date === 0 &&
    selectedTags.length === 0 &&
    excludedTags.length === 0 &&
    includePrefixes.length === 0 &&
    excludePrefixes.length === 0 &&
    (infiniteScroll || page <= 1) &&
    view !== 'list' &&
    items.length > 0;

  const gridItems = useMemo(() => (showFeatured ? items.slice(1) : items), [items, showFeatured]);

  const handlePageChange = useCallback(
    (target: number) => {
      if (loading || target < 1 || target > totalPages || target === page) return;
      updateQuery({ page: target });
      document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [loading, totalPages, page, updateQuery],
  );

  /** F95Zone resets filters when the SAM category tab changes — mirror that here. */
  const handleCategoryChange = useCallback(
    (next: SamCategory) => {
      if (next === category) return;
      setSearchInput('');
      pushedSearchRef.current = '';
      updateQuery({
        category: next,
        search: '',
        creator: '',
        searchIn: 'title',
        prefixFilter: {},
        tagIds: [],
        excludedTagIds: [],
        tagMode: 'or',
      });
    },
    [category, updateQuery],
  );

  function clearAllFilters() {
    setSearchInput('');
    pushedSearchRef.current = '';
    updateQuery({
      search: '',
      creator: '',
      searchIn: 'title',
      date: 0,
      prefixFilter: {},
      tagIds: [],
      excludedTagIds: [],
      tagMode: 'or',
    });
  }

  return (
    <OfflineGate>
      <div className="store-page">
        <FilterSidebar
          category={category}
          onCategory={handleCategoryChange}
          search={searchInput}
          onSearch={setSearchInput}
          searchMode={searchMode}
          onSearchMode={changeSearchMode}
          date={query.date}
          onDate={(days: number) => updateQuery({ date: days })}
          prefixFilter={prefixFilter}
          onPrefixFilter={(next: Record<number, PrefixFilterMode>) =>
            updateQuery({ prefixFilter: next })
          }
          selectedTags={selectedTags}
          excludedTags={excludedTags}
          onTags={(included: SamTag[], excluded: SamTag[]) =>
            updateQuery({
              tagIds: included.map((tg) => tg.id),
              excludedTagIds: excluded.map((tg) => tg.id),
            })
          }
          tagMode={tagMode}
          onTagMode={(next: SamTagMode) => updateQuery({ tagMode: next })}
          onClearAll={clearAllFilters}
          hasActiveFilters={hasActiveFilters}
        />

        <section className="store-main">
          <header className="store-main-head">
            <div className="store-main-heading">
              <h1 className="store-main-title">{t('store.title')}</h1>
              <div className="store-main-stats">
                {totalRows > 0 && (
                  <span>{t('store.results', { count: totalRows.toLocaleString() })}</span>
                )}
                {!infiniteScroll && totalPages > 1 && (
                  <span className="store-main-page-hint">
                    {t('store.pagination.page', { page, total: totalPages })}
                  </span>
                )}
              </div>
            </div>
            <div className="store-main-tools">
              <select
                className="ui-select"
                value={sort}
                aria-label={t('filter.section.sort')}
                onChange={(e) => updateQuery({ sort: e.target.value as SamSort })}
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
              <ViewModeSwitch value={view} onChange={setView} />
              {/* Results are cached for a few minutes; this fetches them again. */}
              <button
                type="button"
                className="ui-btn ui-btn--secondary ui-btn--sm"
                onClick={reload}
                disabled={loading}
                title={t('store.refresh.title')}
              >
                <Icon name="refresh" size={13} />
                {t('common.refresh')}
              </button>
            </div>
          </header>

          {hasActiveFilters && (
            <div className="store-active-filters" role="group" aria-label={t('store.activeFilters')}>
              {query.search.trim() && (
                <ActiveFilter
                  label={`“${query.search.trim()}”`}
                  onRemove={() => {
                    setSearchInput('');
                    pushedSearchRef.current = '';
                    updateQuery({ search: '' });
                  }}
                />
              )}
              {query.creator.trim() && (
                <ActiveFilter
                  label={t('store.filter.developer', { name: query.creator.trim() })}
                  onRemove={() => {
                    setSearchInput('');
                    pushedSearchRef.current = '';
                    updateQuery({ creator: '' });
                  }}
                />
              )}
              {query.date > 0 && (
                <ActiveFilter label={dateRangeLabel(query.date, t)} onRemove={() => updateQuery({ date: 0 })} />
              )}
              {includePrefixes.map((id) => (
                <ActiveFilter
                  key={`pi${id}`}
                  label={resolvePrefix(id)?.name ?? `#${id}`}
                  onRemove={() => {
                    const next = { ...prefixFilter };
                    delete next[id];
                    updateQuery({ prefixFilter: next });
                  }}
                />
              ))}
              {excludePrefixes.map((id) => (
                <ActiveFilter
                  key={`px${id}`}
                  exclude
                  label={resolvePrefix(id)?.name ?? `#${id}`}
                  onRemove={() => {
                    const next = { ...prefixFilter };
                    delete next[id];
                    updateQuery({ prefixFilter: next });
                  }}
                />
              ))}
              {selectedTags.map((tag) => (
                <ActiveFilter
                  key={`t${tag.id}`}
                  label={tag.name}
                  onRemove={() => updateQuery({ tagIds: query.tagIds.filter((id) => id !== tag.id) })}
                />
              ))}
              {excludedTags.map((tag) => (
                <ActiveFilter
                  key={`tx${tag.id}`}
                  exclude
                  label={tag.name}
                  onRemove={() =>
                    updateQuery({ excludedTagIds: query.excludedTagIds.filter((id) => id !== tag.id) })
                  }
                />
              ))}
              <button type="button" className="store-active-clear" onClick={clearAllFilters}>
                {t('filter.clearAll')}
              </button>
            </div>
          )}

          {error != null && items.length === 0 && <StoreError error={error} onRetry={retry} />}

          {loading && items.length === 0 && !error && <GameCardGridSkeleton count={10} />}

          {items.length === 0 && !loading && !error && (
            <div className="store-empty">{t('store.noResults')}</div>
          )}

          {showFeatured && (
            <FeaturedHero
              game={items[0]}
              category={category}
              libraryEntry={libraryIndex.get(items[0].threadId)}
            />
          )}

          {showFeatured && <h2 className="store-section-title">{t('store.section.more')}</h2>}

          {view === 'list' ? (
            items.length > 0 && (
              <StoreList sort={sort} onSort={(next) => updateQuery({ sort: next })}>
                {items.map((game) => (
                  <StoreListRow
                    key={game.threadId}
                    game={game}
                    category={category}
                    libraryEntry={libraryIndex.get(game.threadId)}
                    now={now}
                  />
                ))}
              </StoreList>
            )
          ) : (
            <div className={view === 'covers' ? 'lib-grid lib-grid--covers store-grid--covers' : 'store-grid'}>
              {gridItems.map((game) =>
                view === 'covers' ? (
                  <StoreCoverTile
                    key={game.threadId}
                    game={game}
                    category={category}
                    libraryEntry={libraryIndex.get(game.threadId)}
                    now={now}
                  />
                ) : (
                  <GameCard
                    key={game.threadId}
                    game={game}
                    category={category}
                    libraryEntry={libraryIndex.get(game.threadId)}
                    now={now}
                  />
                ),
              )}
            </div>
          )}

          {/* A failed "next page" keeps what is already on screen and waits for a retry. */}
          {error != null && items.length > 0 && <StoreError error={error} onRetry={retry} />}

          {infiniteScroll && error == null && <div ref={sentinelRef} className="store-sentinel" />}

          {infiniteScroll && loading && items.length > 0 && (
            <LoadingState label={t('common.loading')} variant="inline" />
          )}
          {infiniteScroll && !loading && !hasMore && items.length > 0 && error == null && (
            <div className="store-end">—</div>
          )}

          {!infiniteScroll && (
            <StorePagination
              page={page}
              totalPages={totalPages}
              loading={loading}
              onPage={handlePageChange}
            />
          )}
        </section>
      </div>
    </OfflineGate>
  );
}

/** One active filter above the results; × removes it. */
function ActiveFilter({
  label,
  exclude = false,
  onRemove,
}: {
  label: string;
  exclude?: boolean;
  onRemove: () => void;
}) {
  const { t } = useT();
  return (
    <span className={`store-active-filter${exclude ? ' store-active-filter--exclude' : ''}`}>
      {exclude && <span aria-hidden>−</span>}
      {label}
      <button type="button" aria-label={t('filter.tags.remove', { name: label })} onClick={onRemove}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

/** Retrying clears the error right away, so the button never needs a busy state. */
function StoreError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="store-error" role="alert">
      <span className="store-error-text">
        {t('store.loadFailed', { error: describeIpcError(error, t) })}
      </span>
      <button type="button" className="store-retry-btn" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  );
}
