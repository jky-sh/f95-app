import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import type { LibraryEntry } from '../../hooks/useLibraryIndex';
import { useT } from '../../lib/i18n';
import { formatWhen } from '../../lib/memberPresence';
import type { SamCategory, SamGameCard, SamSort } from '../../types/sam';
import { LibraryCover } from '../library/LibraryCover';
import { Icon } from '../ui/Icon';
import { formatCount } from './GameCard';
import { LibraryBadge, libraryBadgeKind } from './LibraryBadge';

/** What every store view needs to render one listing. */
export interface StoreItemProps {
  game: SamGameCard;
  category: SamCategory;
  libraryEntry?: LibraryEntry;
  /** Clock for "updated … ago" (the grid shares one). */
  now: number;
}

const href = (g: SamGameCard, category: SamCategory) => `/store/game/${g.threadId}?cat=${category}`;

function Flags({ game, libraryEntry }: { game: SamGameCard; libraryEntry?: LibraryEntry }) {
  const { t } = useT();
  const badge = libraryBadgeKind(libraryEntry, game.version);
  return (
    <>
      {badge && libraryEntry && (
        <LibraryBadge kind={badge} entry={libraryEntry} storeVersion={game.version} inline />
      )}
      {game.isNew && (
        <span className="store-card-flag store-card-flag--new" title={t('store.card.new.title')}>
          {t('store.card.new')}
        </span>
      )}
    </>
  );
}

function updatedText(game: SamGameCard, locale: string, now: number, compact = false): string | null {
  if (!game.updatedTs) return game.updatedAt;
  const ms = game.updatedTs * 1000;
  // The list column is narrow: past a month, a short date instead of "7 de ago. de 2026".
  if (compact && now - ms > 30 * 24 * 3600 * 1000) {
    return new Date(ms).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  return formatWhen(ms, locale, now);
}

/* ── Covers: big art, facts over it ─────────────────────────────────────── */

export const StoreCoverTile = memo(function StoreCoverTile({ game, category, libraryEntry, now }: StoreItemProps) {
  const { locale } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const updated = updatedText(game, locale, now);
  return (
    <article className="lib-tile store-tile" onContextMenu={(e) => void openStoreContextMenu(e, game)}>
      <Link to={href(game, category)} state={{ card: game }} className="lib-tile-cover" aria-label={game.title}>
        <LibraryCover url={game.thumbnailUrl} title={game.title} quality="preview" />
        <span className="lib-tile-scrim" aria-hidden />
        <span className="lib-tile-info">
          <span className="lib-tile-title">{game.title}</span>
          <span className="lib-tile-meta">
            {game.creator && <span className="store-tile-dev">{game.creator}</span>}
            {game.rating != null && game.rating > 0 && <span>★ {game.rating.toFixed(1)}</span>}
            {updated && <span>{updated}</span>}
          </span>
        </span>
      </Link>
      <span className="lib-badge-slot store-tile-flags">
        <Flags game={game} libraryEntry={libraryEntry} />
      </span>
      {game.version && <span className="store-tile-version">{game.version}</span>}
    </article>
  );
});

/* ── List: dense rows; the columns F95 can sort by set the sort ─────────── */

const COLUMNS: { key: string; labelKey: string; sort?: SamSort }[] = [
  { key: 'title', labelKey: 'store.col.game', sort: 'title' },
  { key: 'version', labelKey: 'store.col.version' },
  { key: 'rating', labelKey: 'store.col.rating', sort: 'rating' },
  { key: 'likes', labelKey: 'store.col.likes', sort: 'likes' },
  { key: 'views', labelKey: 'store.col.views', sort: 'views' },
  { key: 'updated', labelKey: 'store.col.updated', sort: 'date' },
  { key: 'flags', labelKey: 'store.col.status' },
];

export function StoreList({
  children,
  sort,
  onSort,
}: {
  children: React.ReactNode;
  sort: SamSort;
  onSort: (sort: SamSort) => void;
}) {
  const { t } = useT();
  return (
    <div className="lib-list store-list" role="table">
      <div className="lib-list-row store-list-row lib-list-head" role="row">
        <span className="lib-list-thumb" role="columnheader" aria-hidden />
        {COLUMNS.map((c) => (
          <span key={c.key} className={`lib-list-col store-list-col--${c.key}`} role="columnheader">
            {c.sort ? (
              <button
                type="button"
                className={`lib-list-sort${sort === c.sort ? ' lib-list-sort--active' : ''}`}
                aria-pressed={sort === c.sort}
                onClick={() => onSort(c.sort!)}
              >
                {t(c.labelKey)}
                {sort === c.sort && <Icon name="chevronDown" size={12} />}
              </button>
            ) : (
              t(c.labelKey)
            )}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

export const StoreListRow = memo(function StoreListRow({ game, category, libraryEntry, now }: StoreItemProps) {
  const { locale } = useT();
  const navigate = useNavigate();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const to = href(game, category);
  return (
    <div
      className="lib-list-row store-list-row"
      role="row"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
      onDoubleClick={() => navigate(to, { state: { card: game } })}
    >
      <Link to={to} state={{ card: game }} className="lib-list-thumb" tabIndex={-1} aria-hidden>
        <LibraryCover url={game.thumbnailUrl} title={game.title} quality="preview" />
      </Link>
      <span className="lib-list-col store-list-col--title" role="cell">
        <Link to={to} state={{ card: game }} className="lib-list-title" title={game.title}>
          {game.title}
        </Link>
        {game.creator && <span className="store-list-dev">{game.creator}</span>}
      </span>
      <span className="lib-list-col store-list-col--version" role="cell" title={game.version ?? undefined}>
        {game.version ?? '—'}
      </span>
      <span className="lib-list-col store-list-col--rating" role="cell">
        {game.rating != null && game.rating > 0 ? `★ ${game.rating.toFixed(1)}` : '—'}
      </span>
      <span className="lib-list-col store-list-col--likes" role="cell">
        {game.likes != null ? formatCount(game.likes) : '—'}
      </span>
      <span className="lib-list-col store-list-col--views" role="cell">
        {game.views != null ? formatCount(game.views) : '—'}
      </span>
      <span className="lib-list-col store-list-col--updated" role="cell">
        {updatedText(game, locale, now, true) ?? '—'}
      </span>
      <span className="lib-list-col store-list-col--flags" role="cell">
        <Flags game={game} libraryEntry={libraryEntry} />
      </span>
    </div>
  );
});
