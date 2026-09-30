import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GameDetailBackBar } from '../components/game/GameDetailLayout';
import {
  LibraryCard,
  LibraryCoverTile,
  LibraryList,
  LibraryListRow,
} from '../components/library/LibraryGameViews';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { Icon } from '../components/ui/Icon';
import { ViewModeSwitch, useViewMode } from '../components/ui/ViewModeSwitch';
import { useDownloadsByThread } from '../hooks/useDownloadsByThread';
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
import { useSectionHref } from '../lib/lastSearch';
import * as library from '../lib/library';
import type { LibraryGame, LibrarySort } from '../types/library';
import '../styles/library.css';

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * Folder view: every game inside one collection (any category), with the
 * same views and actions as the library grid. Nested under LibraryLayout so
 * the Steam-skin game-list panel stays visible.
 */
export function LibraryCollectionPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const libraryHref = useSectionHref('/library');
  const { collectionId } = useParams();
  const id = Number(collectionId);

  const [collection, setCollection] = useState<LibraryCollection | null>(null);
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useViewMode('library');
  const [sort, setSort] = useState<LibrarySort>('title');

  const reload = useCallback(async () => {
    try {
      const [cols, mems, all] = await Promise.all([
        listCollections(),
        listMemberships(),
        library.list({ sort }),
      ]);
      const col = cols.find((c) => c.id === id) ?? null;
      setCollection(col);
      const memberIds = new Set(
        mems.filter((m) => m.collectionId === id).map((m) => m.threadId),
      );
      const members = all.filter((g) => memberIds.has(g.threadId));
      setGames(sort === 'title' ? members.sort((a, b) => COLLATOR.compare(a.title, b.title)) : members);
    } catch (err) {
      console.warn('[collections] page load failed', err);
    } finally {
      setLoading(false);
    }
  }, [id, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onChange = () => {
      void reload();
    };
    window.addEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
    const stop = library.onLibraryChange(onChange);
    return () => {
      window.removeEventListener(COLLECTIONS_CHANGE_EVENT, onChange);
      stop();
    };
  }, [reload]);

  const { openLibraryContextMenu, playOrStop } = useLibraryGameActions({ onReload: reload });
  const downloadsByThread = useDownloadsByThread();
  const itemProps = (g: LibraryGame) => ({
    game: g,
    onPrimaryAction: playOrStop,
    onContextMenu: openLibraryContextMenu,
    download: downloadsByThread.get(g.threadId),
  });

  async function onRename() {
    if (collection) await promptRenameCollection(collection, t);
  }

  async function onDelete() {
    if (!collection) return;
    const deleted = await confirmDeleteCollection(collection, t);
    if (deleted) navigate(libraryHref);
  }

  return (
    <div className="lib-page">
      <GameDetailBackBar
        onBack={() => navigate(libraryHref)}
        breadcrumbTo={libraryHref}
        breadcrumbLabel={t('nav.library')}
      />

      {loading ? (
        <GameCardGridSkeleton count={8} />
      ) : !collection ? (
        <div className="ui-empty">
          <Icon name="folder" size={32} />
          <p className="ui-empty-title">{t('library.collections.notFound')}</p>
        </div>
      ) : (
        <>
          <header className="lib-head" style={{ marginTop: 16 }}>
            <Icon name="folder" size={22} className="lib-collection-icon" />
            <h1 className="lib-head-title">{collection.name}</h1>
            <span className="lib-head-stats">
              {games.length === 1
                ? t('library.stats.game', { count: games.length })
                : t('library.stats.games', { count: games.length })}
            </span>
            <span className="lib-head-spacer" />
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => void onRename()}>
              {t('library.collections.rename')}
            </button>
            <button type="button" className="ui-btn ui-btn--danger ui-btn--sm" onClick={() => void onDelete()}>
              <Icon name="trash" size={13} />
              {t('library.collections.delete')}
            </button>
          </header>

          {games.length === 0 ? (
            <div className="ui-empty">
              <Icon name="folder" size={32} />
              <p className="ui-empty-title">{t('library.collections.emptyCollection')}</p>
            </div>
          ) : (
            <>
              <div className="ui-toolbar lib-toolbar">
                <span className="ui-toolbar-spacer" />
                <ViewModeSwitch value={view} onChange={setView} />
              </div>
              {view === 'list' ? (
                <LibraryList
                  games={games}
                  sort={sort}
                  onSort={setSort}
                  renderRow={(g) => <LibraryListRow key={g.threadId} {...itemProps(g)} />}
                />
              ) : (
                <div className={view === 'covers' ? 'lib-grid lib-grid--covers' : 'lib-grid'}>
                  {games.map((g) =>
                    view === 'covers' ? (
                      <LibraryCoverTile key={g.threadId} {...itemProps(g)} />
                    ) : (
                      <LibraryCard key={g.threadId} {...itemProps(g)} />
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
