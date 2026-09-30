import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
import { formatWhen } from '../../lib/memberPresence';
import type { SamCategory, SamGameCard } from '../../types/sam';
import type { LibraryEntry } from '../../hooks/useLibraryIndex';
import { LibraryBadge, libraryBadgeKind } from './LibraryBadge';
import { ContentTagPills } from './ContentTagPills';
import { PrefixPills } from './PrefixPills';

interface Props {
  game: SamGameCard;
  category: SamCategory;
  /** The game's library row, when it is in the library. */
  libraryEntry?: LibraryEntry;
  /** Clock for the "updated … ago" label (the grid shares one). */
  now: number;
}

export function GameCard({ game, category, libraryEntry, now }: Props) {
  const { t, locale } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const badge = libraryBadgeKind(libraryEntry, game.version);
  const updatedMs = game.updatedTs ? game.updatedTs * 1000 : null;
  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      // The game page shows the card's rating, likes and views.
      state={{ card: game }}
      className="store-card"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      {/* padding-top reserves the 16:9 box before the image loads, so
          portrait thumbnails from F95 don't stretch the card. */}
      <div className="store-card-thumb">
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.title}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="store-card-thumb-fallback">{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        {game.version && <div className="store-card-version">{game.version}</div>}
        {badge && libraryEntry && (
          <LibraryBadge kind={badge} entry={libraryEntry} storeVersion={game.version} />
        )}
        {(game.isNew || game.watched) && (
          <div className="store-card-flags">
            {game.isNew && (
              <span className="store-card-flag store-card-flag--new" title={t('store.card.new.title')}>
                {t('store.card.new')}
              </span>
            )}
            {game.watched && (
              <span
                className="store-card-flag store-card-flag--watched"
                title={t('store.card.watched.title')}
              >
                {t('store.card.watched')}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="store-card-body">
        <div title={game.title} className="store-card-title">
          {game.title}
        </div>

        {(game.creator || updatedMs || game.updatedAt) && (
          <div className="store-card-sub">
            {game.creator && <span className="store-card-creator">{game.creator}</span>}
            {updatedMs ? (
              <span
                className="store-card-updated"
                title={t('store.card.updated', {
                  date: new Date(updatedMs).toLocaleString(locale),
                })}
              >
                {formatWhen(updatedMs, locale, now)}
              </span>
            ) : (
              game.updatedAt && <span className="store-card-updated">{game.updatedAt}</span>
            )}
          </div>
        )}

        <PrefixPills prefixIds={game.prefixIds} threadId={game.threadId} />
        <ContentTagPills tagIds={game.tagIds} />

        <div className="store-card-meta">
          {/* SAM reports unrated games as 0. */}
          {game.rating !== null && game.rating > 0 && (
            <Meta label="★" value={game.rating.toFixed(1)} />
          )}
          {game.likes !== null && <Meta label="♥" value={formatCount(game.likes)} />}
          {game.views !== null && <Meta label="👁" value={formatCount(game.views)} />}
        </div>
      </div>
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="store-card-meta-item">
      <span className="store-card-meta-label">{label}</span>
      <span>{value}</span>
    </span>
  );
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
