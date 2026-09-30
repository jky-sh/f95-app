import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
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
}

export function GameCard({ game, category, libraryEntry }: Props) {
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const badge = libraryBadgeKind(libraryEntry, game.version);
  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      style={cardStyle}
      className="store-card"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      <div style={thumbWrap}>
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.title}
            loading="lazy"
            style={thumbImg}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div style={thumbFallback}>{game.title.slice(0, 1).toUpperCase()}</div>
        )}
        {game.version && <div style={versionBadge}>{game.version}</div>}
        {badge && libraryEntry && (
          <LibraryBadge kind={badge} entry={libraryEntry} storeVersion={game.version} />
        )}
      </div>

      <div style={bodyStyle}>
        <div style={titleStyle} title={game.title} className="store-card-title">
          {game.title}
        </div>

        {game.creator && <div style={creatorStyle}>{game.creator}</div>}

        <PrefixPills prefixIds={game.prefixIds} threadId={game.threadId} />
        <ContentTagPills tagIds={game.tagIds} />

        <div style={metaRow}>
          {game.rating !== null && <Meta label="★" value={game.rating.toFixed(1)} />}
          {game.likes !== null && <Meta label="♥" value={formatCount(game.likes)} />}
          {game.views !== null && <Meta label="👁" value={formatCount(game.views)} />}
        </div>
      </div>
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={metaItem}>
      <span style={metaLabel}>{label}</span>
      <span>{value}</span>
    </span>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  overflow: 'hidden',
  textDecoration: 'none',
  color: 'var(--text-secondary)',
  transition: 'transform 0.12s, border-color 0.12s',
};

// See note in LibraryCard: padding-top reserves the 16:9 box BEFORE the
// image loads, so portrait thumbnails from F95 don't stretch the card.
const thumbWrap: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  paddingTop: '56.25%', // 9 / 16
  background: 'var(--bg-sunken)',
  overflow: 'hidden',
};

const thumbImg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbFallback: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 32,
  color: 'var(--text-faint)',
  fontWeight: 800,
};

const versionBadge: React.CSSProperties = {
  position: 'absolute',
  bottom: 6,
  right: 6,
  background: 'rgba(0, 0, 0, 0.75)',
  color: 'var(--text-primary)',
  padding: '2px 8px',
  borderRadius: 3,
  fontSize: 11,
  fontWeight: 600,
};

const bodyStyle: React.CSSProperties = {
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const titleStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.3,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  minHeight: 36,
};

const creatorStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginTop: 4,
  fontSize: 11,
  color: 'var(--text-muted)',
};

const metaItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const metaLabel: React.CSSProperties = {
  color: 'var(--text-faint)',
};
