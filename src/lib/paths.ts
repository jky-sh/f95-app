/**
 * Filesystem path comparisons for install folders. Windows paths are
 * case-insensitive and may mix separators, so compare a normalized form.
 */
function normalize(p: string): string {
  return p.trim().replace(/[/\\]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalize(a) === normalize(b);
}

/** True when `child` is `parent` itself or somewhere below it. */
export function isPathInside(
  child: string | null | undefined,
  parent: string | null | undefined,
): boolean {
  if (!child || !parent) return false;
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** True when one path contains the other (deleting either removes both). */
export function pathsOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  return isPathInside(a, b) || isPathInside(b, a);
}

/** Folder that holds `path` (everything before the last separator). */
export function parentDir(path: string): string {
  return path.replace(/[/\\][^/\\]+$/, '');
}
