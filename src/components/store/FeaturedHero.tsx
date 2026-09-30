import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useT } from '../../lib/i18n';
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

/**
 * Hero card for the top result on the Store page. Big banner with gradient
 * overlay and meta on top — Steam's "What's new" style. Whole card is a
 * Link to the game's detail page.
 *
 * Renders a cleaner "no thumbnail" fallback if the game has no banner so we
 * never end up with an empty grey box up top.
 */
export function FeaturedHero({ game, category, libraryEntry }: Props) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const badge = libraryBadgeKind(libraryEntry, game.version);
  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      style={cardStyle}
      className="store-featured"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      {game.thumbnailUrl ? (
        <img
          src={game.thumbnailUrl}
          alt={game.title}
          style={bannerImg}
          loading="eager"
        />
      ) : (
        <div style={bannerFallback}>
          {game.title.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div style={overlayStyle} />

      <div style={contentStyle}>
        <div style={featuredTagStyle}>{t('store.featured')}</div>

        <h2 style={titleStyle}>{game.title}</h2>

        <div style={metaRow}>
          {badge && libraryEntry && (
            <LibraryBadge kind={badge} entry={libraryEntry} storeVersion={game.version} inline />
          )}
          {game.creator && <span style={creatorStyle}>{game.creator}</span>}
          {game.version && <span style={versionBadge}>{game.version}</span>}
          {game.rating !== null && (
            <span style={statBadge}>
              <span style={statIcon}>★</span> {game.rating.toFixed(1)}
            </span>
          )}
          {game.likes !== null && game.likes >= 100 && (
            <span style={statBadge}>
              <span style={statIcon}>♥</span> {formatCount(game.likes)}
            </span>
          )}
        </div>

        <div style={pillsRow}>
          <PrefixPills prefixIds={game.prefixIds} threadId={game.threadId} />
        </div>
        <ContentTagPills tagIds={game.tagIds} max={6} />

        <div style={ctaRow}>
          <span style={ctaButton}>{t('store.featured.viewDetails')} →</span>
        </div>
      </div>
    </Link>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const cardStyle: React.CSSProperties = {
  position: 'relative',
  display: 'block',
  width: '100%',
  height: 320,
  borderRadius: 8,
  overflow: 'hidden',
  textDecoration: 'none',
  color: 'var(--text-primary)',
  background: 'var(--bg-sunken)',
  marginBottom: 28,
  boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
};

const bannerImg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const bannerFallback: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 96,
  fontWeight: 800,
  color: 'var(--text-faint)',
  background: 'linear-gradient(135deg, var(--bg-elevated), var(--bg-sunken))',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background:
    'linear-gradient(0deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.55) 45%, rgba(10,10,10,0.15) 80%, transparent 100%)',
};

const contentStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '24px 28px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const featuredTagStyle: React.CSSProperties = {
  display: 'inline-block',
  alignSelf: 'flex-start',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  padding: '4px 10px',
  borderRadius: 2,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 32,
  fontWeight: 800,
  letterSpacing: -0.3,
  textShadow: '0 2px 12px rgba(0,0,0,0.5)',
  color: '#ffffff',
  lineHeight: 1.1,
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  fontSize: 13,
};

const creatorStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.85)',
  fontWeight: 600,
  textShadow: '0 1px 4px rgba(0,0,0,0.6)',
};

const versionBadge: React.CSSProperties = {
  background: 'rgba(0,0,0,0.55)',
  color: '#ffffff',
  padding: '2px 8px',
  borderRadius: 2,
  fontSize: 12,
  fontWeight: 600,
};

const statBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'rgba(0,0,0,0.55)',
  color: '#ffffff',
  padding: '2px 8px',
  borderRadius: 2,
  fontSize: 12,
  fontWeight: 600,
};

const statIcon: React.CSSProperties = {
  color: 'var(--status-warning)',
};

const pillsRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const ctaRow: React.CSSProperties = {
  marginTop: 4,
};

const ctaButton: React.CSSProperties = {
  display: 'inline-block',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  padding: '8px 18px',
  borderRadius: 3,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.3,
};
