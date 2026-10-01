import { useEffect } from 'react';
import { loadSamOptions } from '../../lib/samOptionsCache';
import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { fallbackPrefixGroupsForCategory } from '../../lib/fallbackPrefixGroups';
import { loadStoredPrefixGroups } from '../../lib/prefixCatalogStorage';

/** Loads F95 prefix/tag catalogs once per session (persists to localStorage). */
export function CatalogBootstrap() {
  const { setFromGroups } = usePrefixCatalog();
  const { setFromRecord } = useTagCatalog();

  useEffect(() => {
    let cancelled = false;
    loadSamOptions('games')
      .then((result) => {
        if (cancelled) return;
        const stored = loadStoredPrefixGroups();
        const groups =
          result.prefixGroups.length > 0
            ? result.prefixGroups
            : stored.length > 0
              ? stored
              : fallbackPrefixGroupsForCategory('games');
        if (groups.length > 0) {
          setFromGroups(groups);
        }
        setFromRecord(result.tagCatalog);
      })
      .catch((err) => console.warn('[catalog] bootstrap failed', err));
    return () => {
      cancelled = true;
    };
  }, [setFromGroups, setFromRecord]);

  return null;
}
