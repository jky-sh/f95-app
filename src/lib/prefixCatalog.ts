import type { SamPrefixGroup } from '../types/sam';

export interface PrefixMeta {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  cssClass: string | null;
}

/** SAM sends names HTML-escaped ("Ren&#039;Py"). */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? text;
}

export function buildPrefixCatalog(groups: SamPrefixGroup[]): Map<number, PrefixMeta> {
  const map = new Map<number, PrefixMeta>();
  for (const group of groups) {
    for (const p of group.prefixes) {
      map.set(p.id, {
        id: p.id,
        name: decodeEntities(p.name),
        groupId: group.id,
        groupName: decodeEntities(group.name),
        cssClass: p.cssClass,
      });
    }
  }
  return map;
}

export function isStatusGroup(meta: PrefixMeta): boolean {
  const g = meta.groupName.toLowerCase();
  return g === 'status' || meta.groupId === 4;
}

/** XenForo label classes from SAM → pill accent (best-effort). */
export function prefixPillColor(meta: PrefixMeta): string {
  const cls = (meta.cssClass ?? '').toLowerCase();
  const name = meta.name.toLowerCase();

  if (isStatusGroup(meta)) {
    if (name.includes('complete')) return 'var(--status-success)';
    if (name.includes('hold')) return 'var(--status-warning)';
    if (name.includes('abandon')) return '#9c3a3a';
    return 'var(--text-muted)';
  }

  if (cls.includes('renpy') || name.includes("ren'py")) return 'var(--status-purple)';
  if (cls.includes('unity') || name === 'unity') return 'var(--text-faint)';
  if (cls.includes('rpgm') || name === 'rpgm') return 'var(--status-info)';
  if (cls.includes('vn') || name === 'vn') return 'var(--status-info)';
  if (cls.includes('flash')) return 'var(--accent-strong)';
  if (cls.includes('html')) return '#d97a3a';
  if (cls.includes('unreal')) return 'var(--border-faint)';
  if (cls.includes('tads')) return '#6f7e8a';
  if (cls.includes('webgl')) return '#4a9aaa';

  return 'var(--text-muted)';
}
