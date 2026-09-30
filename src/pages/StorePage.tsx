import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterSidebar } from '../components/store/FilterSidebar';
import { GameCard } from '../components/store/GameCard';
import { FeaturedHero } from '../components/store/FeaturedHero';
import { StorePagination } from '../components/store/StorePagination';
import { LoadingState } from '../components/ui/LoadingState';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { useSamList } from '../hooks/useSamList';
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

export function StorePage() {
  const { t } = useT();
  const { settings: storeSettings, loading: storeSettingsLoading } = useStoreSettings();
  const infiniteScroll = storeSettings.scrollMode === 'infinite';
  const { resolve: resolveTag } = useTagCatalog();

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

  // The box updates at once; the URL (and the list) follow when typing pauses.
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
  // Search changed from outside the box (a link, or the URL of a Back).
  useEffect(() => {
    if (query.search === pushedSearchRef.current) return;
    pushedSearchRef.current = query.search;
    setSearchInput(query.search);
  }, [query.search]);

  const selectedTags = useMemo<SamTag[]>(
    () => query.tagIds.map((id) => ({ id, name: resolveTag(id) })),
    [query.tagIds, resolveTag],
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
  const hasActiveFilters =
    searchInput.trim().length > 0 ||
    includePrefixes.length > 0 ||
    excludePrefixes.length > 0 ||
    selectedTags.length > 0;

  const { items, page, totalPages, totalRows, loading, error, hasMore, loadMore, reload, retry } =
    useSamList(
      {
        category,
        sort,
        search: search || undefined,
        prefixes: includePrefixes.length ? includePrefixes : undefined,
        noprefixes: excludePrefixes.length ? excludePrefixes : undefined,
        tags: query.tagIds.length ? query.tagIds : undefined,
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

  const showFeatured = useMemo(() => {
    if (sort !== 'date' || search || selectedTags.length > 0) return false;
    if (includePrefixes.length > 0 || excludePrefixes.length > 0) return false;
    if (!infiniteScroll && page > 1) return false;
    return items.length > 0;
  }, [
    sort,
    search,
    selectedTags.length,
    includePrefixes.length,
    excludePrefixes.length,
    infiniteScroll,
    page,
    items.length,
  ]);

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
      updateQuery({ category: next, search: '', prefixFilter: {}, tagIds: [], tagMode: 'or' });
    },
    [category, updateQuery],
  );

  function clearAllFilters() {
    setSearchInput('');
    pushedSearchRef.current = '';
    updateQuery({ search: '', prefixFilter: {}, tagIds: [], tagMode: 'or' });
  }

  return (
    <OfflineGate>
      <div className="store-page">
        <FilterSidebar
          category={category}
          onCategory={handleCategoryChange}
          search={searchInput}
          onSearch={setSearchInput}
          sort={sort}
          onSort={(next: SamSort) => updateQuery({ sort: next })}
          prefixFilter={prefixFilter}
          onPrefixFilter={(next: Record<number, PrefixFilterMode>) =>
            updateQuery({ prefixFilter: next })
          }
          selectedTags={selectedTags}
          onSelectedTags={(tags: SamTag[]) => updateQuery({ tagIds: tags.map((tg) => tg.id) })}
          tagMode={tagMode}
          onTagMode={(next: SamTagMode) => updateQuery({ tagMode: next })}
          onClearAll={clearAllFilters}
          hasActiveFilters={hasActiveFilters}
        />

        <section className="store-main">
          <header className="store-main-head">
            <h1 className="store-main-title">{t('store.title')}</h1>
            <div className="store-main-tools">
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
              {/* Results are cached for a few minutes; this fetches them again. */}
              <button
                type="button"
                className="store-retry-btn store-refresh-btn"
                onClick={reload}
                disabled={loading}
                title={t('store.refresh.title')}
              >
                <RefreshIcon />
                {t('common.refresh')}
              </button>
            </div>
          </header>

          {error != null && items.length === 0 && <StoreError error={error} onRetry={retry} />}

          {loading && items.length === 0 && !error && <GameCardGridSkeleton count={10} />}

          {items.length === 0 && !loading && !error && (
            <div className="store-empty">{t('store.noResults')}</div>
          )}

          {showFeatured && <FeaturedHero game={items[0]} category={category} />}

          {showFeatured && <h2 className="store-section-title">{t('store.section.more')}</h2>}

          <div className="store-grid">
            {gridItems.map((game) => (
              <GameCard key={game.threadId} game={game} category={category} />
            ))}
          </div>

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

function RefreshIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
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
