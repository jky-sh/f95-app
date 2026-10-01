import { useCallback, useEffect, useState } from 'react';
import {
  addGameToCollection,
  collectionIdsForGame,
  createCollection,
  listCollections,
  MANAGE_COLLECTIONS_EVENT,
  removeGameFromCollection,
  type LibraryCollection,
  type ManageCollectionsDetail,
} from '../../lib/collections';
import { useT } from '../../lib/i18n';

/**
 * Steam's "Add to collection" dialog: a checkbox per collection plus an
 * inline "create new" row (creating immediately adds the game, like
 * Steam). Mounted once in AppShell and opened from anywhere via
 * `openManageCollections` (context menu of library cards / sidebar rows /
 * detail page). Reuses the `.app-dialog-*` styling for consistency.
 */
export function CollectionPickerModal() {
  const { t } = useT();
  const [target, setTarget] = useState<ManageCollectionsDetail | null>(null);
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (threadId: string) => {
    try {
      const [cols, ids] = await Promise.all([listCollections(), collectionIdsForGame(threadId)]);
      setCollections(cols);
      setMemberIds(new Set(ids));
    } catch (err) {
      console.warn('[collections] load failed', err);
    }
  }, []);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<ManageCollectionsDetail>).detail;
      if (!detail?.threadId) return;
      setTarget(detail);
      setNewName('');
      void load(detail.threadId);
    }
    window.addEventListener(MANAGE_COLLECTIONS_EVENT, onOpen);
    return () => window.removeEventListener(MANAGE_COLLECTIONS_EVENT, onOpen);
  }, [load]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  if (!target) return null;

  async function onToggle(col: LibraryCollection) {
    if (!target) return;
    const isMember = memberIds.has(col.id);
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (isMember) next.delete(col.id);
      else next.add(col.id);
      return next;
    });
    try {
      if (isMember) await removeGameFromCollection(col.id, target.threadId);
      else await addGameToCollection(col.id, target.threadId);
    } catch (err) {
      console.warn('[collections] toggle failed', err);
      void load(target.threadId);
    }
  }

  async function onCreate() {
    if (!target) return;
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const id = await createCollection(name);
      if (id !== undefined) {
        await addGameToCollection(id, target.threadId);
      }
      setNewName('');
      await load(target.threadId);
    } catch (err) {
      console.warn('[collections] create failed', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-dialog-overlay" role="presentation" onClick={() => setTarget(null)}>
      <div
        className="app-dialog collection-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('library.collections.manageTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="app-dialog-header">
          <div className="app-dialog-header-text">
            <h2 className="app-dialog-title">{t('library.collections.manageTitle')}</h2>
            <p className="app-dialog-prompt-label">{target.title}</p>
          </div>
          <button
            type="button"
            className="app-dialog-close"
            aria-label={t('common.close')}
            onClick={() => setTarget(null)}
          >
            ×
          </button>
        </header>

        {collections.length === 0 ? (
          <p className="collection-modal-empty">{t('library.collections.empty')}</p>
        ) : (
          <ul className="collection-modal-list">
            {collections.map((c) => (
              <li key={c.id}>
                <label className="collection-modal-row">
                  <input
                    type="checkbox"
                    checked={memberIds.has(c.id)}
                    onChange={() => void onToggle(c)}
                  />
                  <span className="collection-modal-name">{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="collection-modal-new">
          <input
            type="text"
            className="collection-modal-new-input"
            placeholder={t('library.collections.namePlaceholder')}
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
            }}
          />
          <button
            type="button"
            className="app-dialog-btn app-dialog-btn-primary"
            disabled={!newName.trim() || busy}
            onClick={() => void onCreate()}
          >
            {t('library.collections.create')}
          </button>
        </div>

        <footer className="app-dialog-footer">
          <button type="button" className="app-dialog-btn" onClick={() => setTarget(null)}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
