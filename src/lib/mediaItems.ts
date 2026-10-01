import { naturalSortBy } from './naturalSort';
import type { InstallMediaIndex, MediaViewItem } from '../types/media';

/**
 * A scanned install folder as viewer items: images in reading order, then
 * videos, PDFs and comic archives. Shared by the desktop media viewer and
 * Big Picture's reader and player.
 */
export function buildMediaItems(index: InstallMediaIndex): MediaViewItem[] {
  const out: MediaViewItem[] = [];
  const images = naturalSortBy(index.images, (f) => f.path.replace(/\\/g, '/'));
  for (const f of images) {
    out.push({ kind: 'image', path: f.path, name: f.name, size: f.size });
  }
  const videos = naturalSortBy(index.videos, (f) => f.name);
  for (const f of videos) {
    out.push({ kind: 'video', path: f.path, name: f.name, size: f.size });
  }
  const pdfs = naturalSortBy(index.pdfs, (f) => f.path.replace(/\\/g, '/'));
  for (const f of pdfs) {
    out.push({ kind: 'pdf', path: f.path, name: f.name });
  }
  const archives = naturalSortBy(index.archives, (f) => f.path.replace(/\\/g, '/'));
  for (const f of archives) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'cbz' || ext === 'cbr') {
      out.push({ kind: 'cbz', path: f.path, name: f.name });
    }
  }
  return out;
}

/** File name of a page, or "Page N" when the path has none. */
export function pageLabel(path: string, fallbackNum: number): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
  return base || `Page ${fallbackNum}`;
}
