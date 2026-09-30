import { useT } from '../../lib/i18n';
import { versionsEqual } from '../../lib/updates';
import type { LibraryEntry } from '../../hooks/useLibraryIndex';

export type LibraryBadgeKind = 'installed' | 'update' | 'downloading' | 'owned';

/**
 * How a store listing relates to the library: installed (and whether F95
 * shows a newer version than the installed one), downloading, or only
 * added. Null when the game is not in the library.
 */
export function libraryBadgeKind(
  entry: LibraryEntry | undefined,
  storeVersion: string | null,
): LibraryBadgeKind | null {
  if (!entry) return null;
  switch (entry.installStatus) {
    case 'downloading':
    case 'extracting':
      return 'downloading';
    case 'update_available':
      return 'update';
    case 'installed': {
      const installed = entry.currentVersion?.trim();
      const latest = storeVersion?.trim();
      return installed && latest && !versionsEqual(installed, latest) ? 'update' : 'installed';
    }
    default:
      return 'owned';
  }
}

export function LibraryBadge({
  kind,
  entry,
  storeVersion,
  inline = false,
}: {
  kind: LibraryBadgeKind;
  entry: LibraryEntry;
  storeVersion: string | null;
  /** In a row of chips instead of over a thumbnail. */
  inline?: boolean;
}) {
  const { t } = useT();
  const title =
    kind === 'update'
      ? t('store.lib.updateTitle', {
          installed: entry.currentVersion ?? '?',
          latest: storeVersion ?? entry.availableVersion ?? '?',
        })
      : undefined;
  return (
    <span
      className={`store-lib-badge store-lib-badge--${kind}${inline ? ' store-lib-badge--inline' : ''}`}
      title={title}
    >
      {t(`store.lib.${kind}`)}
    </span>
  );
}
