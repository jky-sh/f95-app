import { useNavigate } from 'react-router-dom';
import { useContextMenu } from '../contextMenu';
import { buildCollectionMenu } from '../../lib/collectionActions';
import { useT } from '../../lib/i18n';
import type { LibraryCollection } from '../../lib/collections';
import type { LibraryGame } from '../../types/library';

interface Props {
  collection: LibraryCollection;
  /** Members of the collection (any category) — first 4 thumbs feed the mosaic. */
  games: LibraryGame[];
}

/**
 * Folder card shown in the library's "Collections" shelf: a 2×2 mosaic of
 * member covers (Steam-collection style) with a folder glyph fallback,
 * name + count below. Click opens the collection page; right-click offers
 * rename/delete.
 */
export function CollectionFolderCard({ collection, games }: Props) {
  const { t } = useT();
  const navigate = useNavigate();
  const { openContextMenu } = useContextMenu();

  const thumbs = games.filter((g) => g.thumbnailUrl).slice(0, 4);

  return (
    <button
      type="button"
      className="collection-folder"
      onClick={() => navigate(`/library/collection/${collection.id}`)}
      onContextMenu={(e) => openContextMenu(e, buildCollectionMenu(collection, t))}
      title={collection.name}
    >
      <div className="collection-folder-mosaic">
        {thumbs.length === 0 ? (
          <span className="collection-folder-glyph" aria-hidden>
            <FolderIcon />
          </span>
        ) : (
          thumbs.map((g) => (
            <img key={g.threadId} src={g.thumbnailUrl ?? ''} alt="" loading="lazy" />
          ))
        )}
      </div>
      <div className="collection-folder-body">
        <span className="collection-folder-icon" aria-hidden>
          <FolderIcon />
        </span>
        <span className="collection-folder-name">{collection.name}</span>
        <span className="collection-folder-count">{games.length}</span>
      </div>
    </button>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}
