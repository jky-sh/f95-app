import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  buildTagCatalogFromRecord,
  bundledTagCatalog,
  mergeTagCatalogs,
  resolveTagName,
  type TagCatalog,
} from '../lib/tagCatalog';
import { loadStoredTagCatalog, saveTagCatalog } from '../lib/tagCatalogStorage';

type TagCatalogContextValue = {
  catalog: TagCatalog;
  setFromRecord: (record: Record<string, string> | null | undefined) => void;
  resolve: (id: number) => string;
};

const TagCatalogContext = createContext<TagCatalogContextValue | null>(null);

export function TagCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<TagCatalog>(() =>
    mergeTagCatalogs(bundledTagCatalog(), loadStoredTagCatalog()),
  );

  const setFromRecord = useCallback((record: Record<string, string> | null | undefined) => {
    const next = buildTagCatalogFromRecord(record);
    if (next.size === 0) return;
    setCatalog((prev) => {
      let changed = false;
      for (const [id, name] of next) {
        if (prev.get(id) !== name) {
          changed = true;
          break;
        }
      }
      if (!changed) return prev;
      const merged = mergeTagCatalogs(prev, next);
      saveTagCatalog(merged);
      return merged;
    });
  }, []);

  const resolve = useCallback((id: number) => resolveTagName(catalog, id), [catalog]);

  const value = useMemo(
    () => ({ catalog, setFromRecord, resolve }),
    [catalog, setFromRecord, resolve],
  );

  return <TagCatalogContext.Provider value={value}>{children}</TagCatalogContext.Provider>;
}

export function useTagCatalog(): TagCatalogContextValue {
  const ctx = useContext(TagCatalogContext);
  if (!ctx) {
    throw new Error('useTagCatalog must be used within TagCatalogProvider');
  }
  return ctx;
}
