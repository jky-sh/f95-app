import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilterSidebar } from '../components/store/FilterSidebar';
import { GameCard } from '../components/store/GameCard';
import { FeaturedHero } from '../components/store/FeaturedHero';
import { StorePagination } from '../components/store/StorePagination';
import { LoadingState } from '../components/ui/LoadingState';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { useSamList } from '../hooks/useSamList';
import { useStoreSettings } from '../contexts/StoreSettings';
import { OfflineGate } from '../components/OfflineGate';
import { useT } from '../lib/i18n';
import { describeIpcError } from '../lib/ipcError';
import type {
  PrefixFilterMode,
  SamCategory,
  SamSort,
  SamTag,
  SamTagMode,
} from '../types/sam';

export function StorePage() {
  const { t } = useT();
  const { settings: storeSettings } = useStoreSettings();
  const infiniteScroll = storeSettings.scrollMode === 'infinite';
  const [category, setCategory] = useState<SamCategory>('games');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SamSort>('date');
  const [prefixFilter, setPrefixFilter] = useState<Record<number, PrefixFilterMode>>({});
  const [selectedTags, setSelectedTags] = useState<SamTag[]>([]);
  const [tagMode, setTagMode] = useState<SamTagMode>('or');

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

  const hasActiveFilters =
    search.trim().length > 0 ||
    includePrefixes.length > 0 ||
    excludePrefixes.length > 0 ||
    selectedTags.length > 0;

  const {
    items,
    page,
    totalPages,
    totalRows,
    loading,
    error,
    hasMore,
    loadMore,
    goToPage,
    reload,
    retry,
  } = useSamList({
    category,
    sort,
    search: search.trim() || undefined,
    prefixes: includePrefixes.length ? includePrefixes : undefined,
    noprefixes: excludePrefixes.length ? excludePrefixes : undefined,
    tags: selectedTags.length ? selectedTags.map((tg) => tg.id) : undefined,
    tagtype: selectedTags.length ? tagMode : undefined,
  });

  const scrollModeRef = useRef(storeSettings.scrollMode);
  useEffect(() => {
    if (scrollModeRef.current === storeSettings.scrollMode) return;
    scrollModeRef.current = storeSettings.scrollMode;
    reload();
  }, [storeSettings.scrollMode, reload]);

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
      goToPage(target);
      document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [goToPage],
  );

  /** F95Zone resets filters when the SAM category tab changes — mirror that here. */
  const handleCategoryChange = useCallback(
    (next: SamCategory) => {
      if (next === category) return;
      setCategory(next);
      setPrefixFilter({});
      setSelectedTags([]);
      setSearch('');
      setTagMode('or');
    },
    [category],
  );

  function clearAllFilters() {
    setSearch('');
    setPrefixFilter({});
    setSelectedTags([]);
    setTagMode('or');
  }

  return (
    <OfflineGate>
      <div className="store-page">
        <FilterSidebar
          category={category}
          onCategory={handleCategoryChange}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
          prefixFilter={prefixFilter}
          onPrefixFilter={setPrefixFilter}
          selectedTags={selectedTags}
          onSelectedTags={setSelectedTags}
          tagMode={tagMode}
          onTagMode={setTagMode}
          onClearAll={clearAllFilters}
          hasActiveFilters={hasActiveFilters}
        />

        <section className="store-main">
          <header className="store-main-head">
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
