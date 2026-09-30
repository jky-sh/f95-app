import { useMemo } from 'react';
import { usePrefixCatalog } from '../contexts/PrefixCatalogContext';
import { useTagCatalog } from '../contexts/TagCatalogContext';
import { storeLink } from '../lib/storeQuery';
import { KNOWN_PREFIXES, type SamCategory } from '../types/sam';

/**
 * Store lists a game page can link to: more games with the same tag, prefix
 * or developer. Thread pages only carry names, so the ids come from the SAM
 * catalogs; a name the catalogs don't know gets no link (null).
 */
export function useStoreLinks(category: SamCategory) {
  const { catalog: tagCatalog } = useTagCatalog();
  const { catalog: prefixCatalog } = usePrefixCatalog();

  const tagIds = useMemo(() => {
    const byName = new Map<string, number>();
    for (const [id, name] of tagCatalog) byName.set(name.toLowerCase(), id);
    return byName;
  }, [tagCatalog]);

  const prefixIds = useMemo(() => {
    const byName = new Map<string, number>();
    if (category === 'games') {
      for (const p of KNOWN_PREFIXES) byName.set(p.name.toLowerCase(), p.id);
    }
    for (const [id, meta] of prefixCatalog) byName.set(meta.name.toLowerCase(), id);
    return byName;
  }, [prefixCatalog, category]);

  return useMemo(
    () => ({
      tag(name: string): string | null {
        const id = tagIds.get(name.trim().toLowerCase());
        return id ? storeLink({ category, tagIds: [id] }) : null;
      },
      prefix(name: string): string | null {
        const id = prefixIds.get(name.trim().toLowerCase());
        return id ? storeLink({ category, prefixFilter: { [id]: 'include' } }) : null;
      },
      developer(name: string): string | null {
        const creator = name.trim();
        return creator ? storeLink({ category, creator, searchIn: 'creator' }) : null;
      },
    }),
    [category, tagIds, prefixIds],
  );
}
