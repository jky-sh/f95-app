/**
 * Shared UI flows for collection management (rename / delete with the app
 * dialogs) plus the right-click menu used by the Steam sidebar groups, the
 * library folder cards and the collection page.
 */
import type { ContextMenuItem } from '../components/contextMenu/types';
import {
  deleteCollection,
  renameCollection,
  type LibraryCollection,
} from './collections';
import { dialog } from './dialog';
import type { TFunction } from './i18n';

export async function promptRenameCollection(
  col: LibraryCollection,
  t: TFunction,
): Promise<void> {
  const next = await dialog.prompt(t('library.collections.renamePrompt'), {
    title: t('library.collections.manageTitle'),
    defaultValue: col.name,
  });
  if (next && next.trim()) {
    await renameCollection(col.id, next.trim());
  }
}

/** Returns true when the collection was actually deleted. */
export async function confirmDeleteCollection(
  col: LibraryCollection,
  t: TFunction,
): Promise<boolean> {
  const ok = await dialog.confirm(t('library.collections.deleteConfirm', { name: col.name }), {
    title: t('library.collections.delete'),
    kind: 'warning',
  });
  if (ok) {
    await deleteCollection(col.id);
  }
  return ok;
}

export function buildCollectionMenu(
  col: LibraryCollection,
  t: TFunction,
  opts?: { onDeleted?: () => void },
): ContextMenuItem[] {
  return [
    {
      id: 'rename',
      label: t('library.collections.rename'),
      onClick: () => promptRenameCollection(col, t),
    },
    {
      id: 'delete',
      label: t('library.collections.delete'),
      danger: true,
      onClick: async () => {
        const deleted = await confirmDeleteCollection(col, t);
        if (deleted) opts?.onDeleted?.();
      },
    },
  ];
}
