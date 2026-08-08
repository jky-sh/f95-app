import { buildTagCatalogFromRecord, catalogToRecord, type TagCatalog } from './tagCatalog';

const STORAGE_KEY = 'f95-tag-catalog-v1';

export function loadStoredTagCatalog(): TagCatalog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as { tags?: Record<string, string> };
    return buildTagCatalogFromRecord(parsed.tags);
  } catch {
    return new Map();
  }
}

export function saveTagCatalog(catalog: TagCatalog): void {
  if (catalog.size === 0) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tags: catalogToRecord(catalog), savedAt: Date.now() }),
    );
  } catch {
    // ignore quota / private mode
  }
}
