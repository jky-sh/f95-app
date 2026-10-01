import { useCallback, useEffect, useState } from 'react';
import { SAM_CATEGORIES } from '../../../constants/samCategories';
import { useOffline } from '../../../contexts/Offline';
import { useLibraryIndex, type LibraryIndex } from '../../../hooks/useLibraryIndex';
import { useSamList } from '../../../hooks/useSamList';
import { toF95PreviewUrl } from '../../../lib/f95ImageUrl';
import { describeIpcError } from '../../../lib/ipcError';
import { useT } from '../../../lib/i18n';
import type { SamCategory, SamFilters, SamGameCard } from '../../../types/sam';
import { LibraryCover } from '../../library/LibraryCover';
import { ContentTagPills } from '../../store/ContentTagPills';
import { formatCount } from '../../store/GameCard';
import { Icon } from '../../ui/Icon';
import { useBp } from '../BpContext';
import { BpEmpty, BpLoader, BpShelf, BpStoreTile, markWholeArt, useProgressiveArt } from '../BpParts';

const ROWS = 18;
const FEATURED = 6;
const FEATURED_MS = 7000;

/** SAM ids of the "Completed" status prefix (games). */
const COMPLETED_PREFIX = 18;

interface ShelfSpec {
  id: string;
  titleKey: string;
  filters: Pick<SamFilters, 'sort' | 'date' | 'prefixes'>;
  gamesOnly?: boolean;
}

/** Below the featured games; each shelf loads after the one above it. */
const SHELVES: ShelfSpec[] = [
  { id: 'latest', titleKey: 'bp.store.shelf.latest', filters: { sort: 'date' } },
  { id: 'views', titleKey: 'bp.store.shelf.views', filters: { sort: 'views', date: 30 } },
  { id: 'rated', titleKey: 'bp.store.shelf.rated', filters: { sort: 'rating', date: 90 } },
  { id: 'completed', titleKey: 'bp.store.shelf.completed', filters: { sort: 'date', prefixes: [COMPLETED_PREFIX] }, gamesOnly: true },
];

/**
 * The store as a storefront: this week's most liked games in a large
 * carousel, then shelves (just updated, most viewed, best rated, completed)
 * and a way into the full, filterable list.
 */
export function BpStore() {
  const { t } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();
  const libraryIndex = useLibraryIndex();
  const [category, setCategory] = useState<SamCategory>('games');
  /** `category:shelf` of every shelf that loaded or failed. Never cleared: a
   *  shelf restored from the list cache (Home shares "just updated") reports
   *  while mounting, and a reset there would hold back every shelf below it. */
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  const [art, setArt] = useState<string | null>(null);

  const week = useSamList({ category, sort: 'likes', date: 7, rows: ROWS }, { enabled: !isOffline });
  const weekSettled = week.items.length > 0 || week.error != null;

  const onSettled = useCallback((key: string) => {
    setSettled((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const onFocusCard = useCallback((card: SamGameCard) => setArt(card.thumbnailUrl), []);

  useEffect(() => {
    const timer = window.setTimeout(() => bp.setBackdrop(art ?? week.items[0]?.thumbnailUrl ?? null), 140);
    return () => window.clearTimeout(timer);
  }, [bp, art, week.items]);

  if (isOffline) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpEmpty icon="alert" title={t('nav.offline')} text={t('bp.store.offline')} />
      </div>
    );
  }

  const shelves = SHELVES.filter((s) => !s.gamesOnly || category === 'games');

  return (
    <div className="bp-screen-body bp-page bp-storefront" data-bp-scroll-y="">
      <div className="bp-store-nav" data-bp-snap="top">
        <div className="bp-chip-row" data-bp-group="store-category" data-bp-row="">
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
        <div className="bp-store-nav-side" data-bp-group="store-nav" data-bp-row="">
          <button type="button" className="bp-btn bp-btn--sm bp-focusable" onClick={() => bp.push({ screen: 'search' })}>
            <Icon name="search" size={18} />
            {t('bp.search')}
          </button>
          <button
            type="button"
            className="bp-btn bp-btn--sm bp-focusable"
            onClick={() => bp.push({ screen: 'storeBrowse', category })}
          >
            <Icon name="grid" size={18} />
            {t('bp.store.browse')}
          </button>
        </div>
      </div>

      {week.items.length > 0 ? (
        <BpFeatured key={category} cards={week.items.slice(0, FEATURED)} category={category} onFocusCard={onFocusCard} />
      ) : week.error != null ? (
        <BpEmpty
          icon="alert"
          title={t('bp.store.error')}
          text={describeIpcError(week.error, t)}
          action={
            <button type="button" className="bp-btn bp-btn--primary bp-focusable" data-bp-autofocus="" onClick={week.retry}>
              {t('bp.store.retry')}
            </button>
          }
        />
      ) : (
        <div className="bp-featured bp-featured--loading">
          <BpLoader label={t('common.loading')} />
        </div>
      )}

      {week.items.length > FEATURED && (
        <BpShelf id="store-week" title={t('bp.store.shelf.week')}>
          {week.items.map((card, i) => (
            <BpStoreTile
              key={card.threadId}
              card={card}
              category={category}
              group="store-week"
              index={i}
              entry={libraryIndex.get(card.threadId)}
              onFocusCard={onFocusCard}
            />
          ))}
        </BpShelf>
      )}

      {shelves.map((shelf, i) => (
        <StoreShelf
          key={`${category}-${shelf.id}`}
          spec={shelf}
          category={category}
          enabled={i === 0 ? weekSettled : settled.has(`${category}:${shelves[i - 1].id}`)}
          libraryIndex={libraryIndex}
          onSettled={onSettled}
          onFocusCard={onFocusCard}
        />
      ))}

      <div className="bp-store-more">
        <button
          type="button"
          className="bp-btn bp-btn--lg bp-focusable"
          onClick={() => bp.push({ screen: 'storeBrowse', category })}
        >
          <Icon name="grid" size={20} />
          {t('bp.store.browseAll')}
        </button>
      </div>
    </div>
  );
}

function StoreShelf({
  spec,
  category,
  enabled,
  libraryIndex,
  onSettled,
  onFocusCard,
}: {
  spec: ShelfSpec;
  category: SamCategory;
  enabled: boolean;
  libraryIndex: LibraryIndex;
  onSettled: (key: string) => void;
  onFocusCard: (card: SamGameCard) => void;
}) {
  const { t } = useT();
  const list = useSamList({ category, ...spec.filters, rows: ROWS }, { enabled });
  const done = list.items.length > 0 || list.error != null;
  useEffect(() => {
    if (done) onSettled(`${category}:${spec.id}`);
  }, [done, category, spec.id, onSettled]);

  // A failed or empty shelf just stays out of the way.
  if (done && list.items.length === 0) return null;
  return (
    <BpShelf id={`store-${spec.id}`} title={t(spec.titleKey)}>
      {list.items.length === 0 ? (
        <BpLoader />
      ) : (
        list.items.map((card, i) => (
          <BpStoreTile
            key={card.threadId}
            card={card}
            category={category}
            group={`store-${spec.id}`}
            index={i}
            entry={libraryIndex.get(card.threadId)}
            onFocusCard={onFocusCard}
          />
        ))
      )}
    </BpShelf>
  );
}

/**
 * This week's most liked games, one at a time: large art, screenshots and
 * tags beside it, and a row of thumbnails below. Focusing a thumbnail shows
 * that game; otherwise it moves on by itself.
 */
function BpFeatured({
  cards,
  category,
  onFocusCard,
}: {
  cards: SamGameCard[];
  category: SamCategory;
  onFocusCard: (card: SamGameCard) => void;
}) {
  const { t } = useT();
  const bp = useBp();
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const card = cards[Math.min(index, cards.length - 1)];
  const art = useProgressiveArt(card.thumbnailUrl);

  useEffect(() => {
    if (held || cards.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % cards.length), FEATURED_MS);
    return () => window.clearInterval(timer);
  }, [held, cards.length]);

  return (
    <section
      className="bp-featured"
      data-bp-snap="top"
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="bp-featured-main" key={card.threadId}>
        <button
          type="button"
          className="bp-featured-art bp-focusable"
          data-bp-autofocus=""
          data-bp-a={t('bp.hint.open')}
          data-bp-x={t('bp.hint.options')}
          onClick={() => bp.openStoreGame(card, category)}
          onFocus={() => onFocusCard(card)}
          onContextMenu={(e) => {
            e.preventDefault();
            bp.openStoreOptions(card, category);
          }}
        >
          {art && (
            <>
              <img className="bp-featured-art-fill" src={art} alt="" draggable={false} aria-hidden />
              <img src={art} alt="" draggable={false} onLoad={markWholeArt} />
            </>
          )}
        </button>
        <div className="bp-featured-info">
          <span className="bp-featured-label">{t('bp.store.featured')}</span>
          <h2 className="bp-featured-title">{card.title}</h2>
          <div className="bp-meta">
            {card.creator && <span>{card.creator}</span>}
            {card.version && <span>{card.version}</span>}
            {card.rating != null && card.rating > 0 && (
              <span>
                <Icon name="star" size={15} /> {card.rating.toFixed(1)}
              </span>
            )}
            {card.likes != null && (
              <span>
                <Icon name="heart" size={15} /> {formatCount(card.likes)}
              </span>
            )}
          </div>
          {card.screens.length > 0 && (
            <div className="bp-featured-shots">
              {card.screens.slice(0, 4).map((src) => (
                <img key={src} src={toF95PreviewUrl(src)} alt="" loading="lazy" draggable={false} />
              ))}
            </div>
          )}
          <ContentTagPills tagIds={card.tagIds} max={6} />
        </div>
      </div>
      <div className="bp-featured-thumbs" data-bp-group="featured" data-bp-row="">
        {cards.map((c, i) => (
          <button
            key={c.threadId}
            type="button"
            className="bp-featured-thumb bp-focusable"
            aria-current={i === index || undefined}
            aria-label={c.title}
            data-bp-a={t('bp.hint.open')}
            onFocus={() => {
              setIndex(i);
              onFocusCard(c);
            }}
            onClick={() => bp.openStoreGame(c, category)}
          >
            <LibraryCover url={c.thumbnailUrl} title={c.title} quality="preview" />
          </button>
        ))}
      </div>
    </section>
  );
}
