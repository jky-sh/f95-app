import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GameDetailBackBar } from '../components/game/GameDetailLayout';
import { LibraryCard } from '../components/library/LibraryCard';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { useLibraryGameActions } from '../hooks/useLibraryGameActions';
import {
  confirmDeleteCollection,
  promptRenameCollection,
} from '../lib/collectionActions';
import {
  COLLECTIONS_CHANGE_EVENT,
  listCollections,
  listMemberships,
  type LibraryCollection,
} from '../lib/collections';
import { useT } from '../lib/i18n';
import * as library from '../lib/library';
import type { LibraryGame } from '../types/library';

/**
 * Folder view: lists every game inside one collection (any category),
 * alphabetically, with the same cards/actions as the library grid. Nested
 * under LibraryLayout so the Steam-skin game-list panel stays visible.
 */
export function LibraryCollectionPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { collectionId } = useParams();
  const id = Number(collectionId);

  const [collection, setCollection] = useState<LibraryCollection | null>(null);
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [cols, mems, all] = await Promise.all([
        listCollections(),
        listMemberships(),
        library.list({}),
      ]);
      const col = cols.find((c) => c.id === id) ?? null;
      setCollection(col);
      const memberIds = new Set(
        mems.filter((m) => m.collectionId === id).map((m) => m.threadId),
      );
      setGames(
        all
          .filter((g) => memberIds.has(g.threadId))
          .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
      );
    } catch (err) {
      console.warn('[collections] page load failed', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onChange = () => {
      void reload();
    };
    window.addEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
  }, [reload]);

  const { openLibraryContextMenu, playOrStop } = useLibraryGameActions({ onReload: reload });

  async function onRename() {
    if (collection) await promptRenameCollection(collection, t);
  }

  async function onDelete() {
    if (!collection) return;
    const deleted = await confirmDeleteCollection(collection, t);
    if (deleted) navigate('/library');
  }

  return (
    <div style={pageStyle}>
      <GameDetailBackBar
        onBack={() => navigate('/library')}
        breadcrumbTo="/library"
        breadcrumbLabel={t('nav.library')}
      />

      {loading ? (
        <GameCardGridSkeleton count={8} />
      ) : !collection ? (
        <div style={emptyBox}>{t('library.collections.notFound')}</div>
      ) : (
        <>
          <header style={headerStyle}>
            <h1 style={titleStyle}>
              <span style={folderIconStyle} aria-hidden>
                <FolderIcon />
              </span>
              {collection.name}
            </h1>
            <div style={headerSideStyle}>
              <span style={statsStyle}>
                {games.length === 1
                  ? t('library.stats.game', { count: games.length })
                  : t('library.stats.games', { count: games.length })}
              </span>
              <button type="button" style={actionBtn} onClick={() => void onRename()}>
                {t('library.collections.rename')}
              </button>
              <button
                type="button"
                style={{ ...actionBtn, color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
                onClick={() => void onDelete()}
              >
                {t('library.collections.delete')}
              </button>
            </div>
          </header>

          {games.length === 0 ? (
            <div style={emptyBox}>{t('library.collections.emptyCollection')}</div>
          ) : (
            <div style={gridStyle}>
              {games.map((g) => (
                <LibraryCard
                  key={g.threadId}
                  game={g}
                  onPrimaryAction={playOrStop}
                  onContextMenu={openLibraryContextMenu}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

const pageStyle: React.CSSProperties = {
  padding: '20px 24px 40px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 14,
  margin: '16px 0',
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-faint)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text-primary)',
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
};

const folderIconStyle: React.CSSProperties = {
  display: 'inline-flex',
  color: 'var(--accent)',
  flexShrink: 0,
};

const headerSideStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const statsStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginRight: 6,
};

const actionBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 14,
};

const emptyBox: React.CSSProperties = {
  textAlign: 'center',
  padding: '60px 20px',
  color: 'var(--text-muted)',
  fontSize: 14,
};
