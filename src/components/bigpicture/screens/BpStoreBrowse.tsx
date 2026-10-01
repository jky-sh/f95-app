import { useCallback, useEffect, useRef, useState } from 'react';
import { SAM_CATEGORIES } from '../../../constants/samCategories';
import { useOffline } from '../../../contexts/Offline';
import { useLibraryIndex } from '../../../hooks/useLibraryIndex';
import { useSamList } from '../../../hooks/useSamList';
import { describeIpcError } from '../../../lib/ipcError';
import { useT } from '../../../lib/i18n';
import type { SamCategory, SamGameCard, SamSort } from '../../../types/sam';
import { useBp } from '../BpContext';
import { BpEmpty, BpGrid, BpLoader, BpStoreTile } from '../BpParts';

export const STORE_SORTS: { id: SamSort; labelKey: string }[] = [
  { id: 'date', labelKey: 'bp.store.sort.date' },
  { id: 'likes', labelKey: 'bp.store.sort.likes' },
  { id: 'rating', labelKey: 'bp.store.sort.rating' },
  { id: 'views', labelKey: 'bp.store.sort.views' },
];

/** Load the next page when the focus gets this close to the end. */
const PREFETCH_ITEMS = 10;

/** Every listing of a category as a grid, sorted like the site's tabs. */
export function BpStoreBrowse({ initialCategory }: { initialCategory: SamCategory }) {
  const { t } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();
  const libraryIndex = useLibraryIndex();
  const [category, setCategory] = useState<SamCategory>(initialCategory);
  const [sort, setSort] = useState<SamSort>('date');
  const [art, setArt] = useState<string | null>(null);

  const list = useSamList({ category, sort, rows: 30 }, { mode: 'infinite', enabled: !isOffline });
  const { items, loading, error, hasMore, loadMore, retry } = list;

  const listRef = useRef({ count: items.length, hasMore, loading, loadMore });
  listRef.current = { count: items.length, hasMore, loading, loadMore };

  const onFocusCard = useCallback((card: SamGameCard, index: number) => {
    setArt(card.thumbnailUrl);
    const l = listRef.current;
    if (l.hasMore && !l.loading && index >= l.count - PREFETCH_ITEMS) l.loadMore();
  }, []);

  const firstArt = items[0]?.thumbnailUrl ?? null;
  useEffect(() => {
    const timer = window.setTimeout(() => bp.setBackdrop(art ?? firstArt), 140);
    return () => window.clearTimeout(timer);
  }, [bp, art, firstArt]);

  // Scrolling with the mouse or the right stick reaches the end too.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasItems = items.length > 0;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const l = listRef.current;
        if (entries.some((e) => e.isIntersecting) && l.hasMore && !l.loading) l.loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasItems]);

  if (isOffline) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpEmpty icon="alert" title={t('nav.offline')} text={t('bp.store.offline')} />
      </div>
    );
  }

  return (
    <div className="bp-screen-body bp-page" data-bp-scroll-y="">
      <h1 className="bp-page-title">{t('bp.store.browse')}</h1>
      <div className="bp-filter-line">
        <div className="bp-chip-row" data-bp-group="browse-category" data-bp-row="">
          {SAM_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="bp-chip bp-focusable"
              aria-pressed={c.id === category}
              onClick={() => setCategory(c.id)}
            >
              {c.literal ?? t(c.labelKey)}
            </button>
          ))}
        </div>
        <div className="bp-chip-row" data-bp-group="browse-sort" data-bp-row="">
          <span className="bp-chip-label">{t('library.sort.label')}</span>
          {STORE_SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="bp-chip bp-focusable"
              aria-pressed={s.id === sort}
              onClick={() => setSort(s.id)}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        error != null ? (
          <BpEmpty
            icon="alert"
            title={t('bp.store.error')}
            text={describeIpcError(error, t)}
            action={
              <button type="button" className="bp-btn bp-btn--primary bp-focusable" data-bp-autofocus="" onClick={retry}>
                {t('bp.store.retry')}
              </button>
            }
          />
        ) : (
          <div className="bp-center bp-center--pad">
            <BpLoader label={t('common.loading')} />
          </div>
        )
      ) : (
        <>
          <BpGrid key={`${category}-${sort}`}>
            {items.map((card, i) => (
              <BpStoreTile
                key={card.threadId}
                card={card}
                category={category}
                group="browse"
                index={i}
                autoFocus={i === 0}
                entry={libraryIndex.get(card.threadId)}
                onFocusCard={onFocusCard}
              />
            ))}
          </BpGrid>
          <div ref={sentinelRef} className="bp-grid-end">
            {loading && <BpLoader label={t('bp.store.loadingMore')} />}
            {error != null && !loading && (
              <button type="button" className="bp-btn bp-focusable" onClick={retry}>
                {t('bp.store.retry')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
