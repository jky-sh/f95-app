import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import * as pdfjs from 'pdfjs-dist';
import * as ipc from '../../lib/ipc';
import {
  folderForPath,
  groupMediaIntoFolders,
  shouldUseFolderNav,
  type MediaFolderGroup,
} from '../../lib/mediaFolders';
import { sortPaths } from '../../lib/naturalSort';
import { buildMediaItems, pageLabel } from '../../lib/mediaItems';
import { useT } from '../../lib/i18n';
import type { InstallMediaIndex, MediaViewItem } from '../../types/media';
import type { LibraryGame } from '../../types/library';
import { clearViewerPreviewCaches } from '../../lib/thumbQueue';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import { PageSidebar } from './PageSidebar';
import { ReaderImage } from './ReaderImage';
import { VideoSidebar } from './VideoSidebar';
import { LoadingState } from '../ui/LoadingState';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type FitMode = 'contain' | 'width';

interface Props {
  game: LibraryGame;
  onClose: () => void;
}

interface ImageSequence {
  items: MediaViewItem[];
  index: number;
  activePath: string;
}

export function MediaViewer({ game, onClose }: Props) {
  const { t } = useT();
  const [index, setIndex] = useState<InstallMediaIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaViewItem | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [cbzLoading, setCbzLoading] = useState(false);
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [activeFolderRel, setActiveFolderRel] = useState<string | null>(null);

  const items = useMemo(() => (index ? buildMediaItems(index) : []), [index]);
  const imageItems = useMemo(() => items.filter((i) => i.kind === 'image'), [items]);
  const videoItems = useMemo(() => items.filter((i) => i.kind === 'video'), [items]);

  /** Items used to detect folder layout (animations: images + videos together). */
  const folderSourceItems = useMemo(() => {
    if (game.category === 'animations') {
      return items.filter((i) => i.kind === 'image' || i.kind === 'video');
    }
    if (game.category === 'comics') {
      return imageItems;
    }
    return items.filter((i) => i.kind === 'image' || i.kind === 'video');
  }, [items, imageItems, game.category]);

  const mediaFolders = useMemo(
    () =>
      game.installPath
        ? groupMediaIntoFolders(folderSourceItems, game.installPath, t('mediaViewer.folder.root'))
        : [],
    [folderSourceItems, game.installPath, t],
  );
  const useFolderNav = shouldUseFolderNav(mediaFolders);

  const syncFolderForItem = useCallback(
    (item: MediaViewItem) => {
      if (!game.installPath) return;
      const source =
        game.category === 'animations'
          ? items.filter((i) => i.kind === 'image' || i.kind === 'video')
          : imageItems;
      const folders = groupMediaIntoFolders(
        source,
        game.installPath,
        t('mediaViewer.folder.root'),
      );
      if (!shouldUseFolderNav(folders)) return;
      const folder = folderForPath(folders, game.installPath, item.path);
      if (folder) setActiveFolderRel(folder.relPrefix);
    },
    [game.installPath, game.category, items, imageItems, t],
  );

  const effectiveFolderRel = useMemo(() => {
    if (!useFolderNav) return null;
    if (activeFolderRel !== null) return activeFolderRel;
    if (selected && game.installPath) {
      return (
        folderForPath(mediaFolders, game.installPath, selected.path)?.relPrefix ??
        mediaFolders[0]?.relPrefix ??
        ''
      );
    }
    return mediaFolders[0]?.relPrefix ?? '';
  }, [activeFolderRel, useFolderNav, mediaFolders, selected, game.installPath]);

  const scopedImageItems = useMemo(
    () => scopeItemsByFolder(imageItems, mediaFolders, useFolderNav, effectiveFolderRel),
    [imageItems, mediaFolders, useFolderNav, effectiveFolderRel],
  );

  const scopedVideoItems = useMemo(
    () => scopeItemsByFolder(videoItems, mediaFolders, useFolderNav, effectiveFolderRel),
    [videoItems, mediaFolders, useFolderNav, effectiveFolderRel],
  );

  const selectItem = useCallback(async (item: MediaViewItem) => {
    if (item.kind === 'cbz') {
      setCbzLoading(true);
      try {
        const preview = await ipc.extractCbzPreview({ archivePath: item.path, maxPages: 300 });
        const pages = sortPaths(preview.pages);
        const cbzItem: MediaViewItem = { ...item, cbzPages: pages };
        setSelected(cbzItem);
        setActivePath(pages[0] ?? null);
      } catch (err) {
        setError(formatErr(err));
      } finally {
        setCbzLoading(false);
      }
      return;
    }
    setSelected(item);
    if (item.kind === 'image') setActivePath(item.path);
    syncFolderForItem(item);
  }, [syncFolderForItem]);

  useEffect(() => {
    if (!game.installPath) {
      setError(t('mediaViewer.noInstallPath'));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setActiveFolderRel(null);
    setLoading(true);
    ipc
      .scanInstallMedia({ installPath: game.installPath, category: game.category })
      .then(async (idx) => {
        if (cancelled) return;
        setIndex(idx);
        const built = buildMediaItems(idx);
        const folderItems =
          game.category === 'animations'
            ? built.filter((i) => i.kind === 'image' || i.kind === 'video')
            : built.filter((i) => i.kind === 'image');
        const folders = groupMediaIntoFolders(
          folderItems,
          game.installPath!,
          t('mediaViewer.folder.root'),
        );
        const suggested = idx.suggestedEntry
          ? built.find((i) => i.path === idx.suggestedEntry)
          : undefined;
        const first =
          suggested ??
          (game.category === 'animations'
            ? built.find((i) => i.kind === 'video')
            : undefined) ??
          built.find((i) => i.kind === 'image') ??
          built[0];
        if (!first || cancelled) return;
        if (shouldUseFolderNav(folders)) {
          const folder = folderForPath(folders, game.installPath!, first.path);
          if (folder) setActiveFolderRel(folder.relPrefix);
        }
        if (first.kind === 'cbz') {
          await selectItem(first);
        } else {
          setSelected(first);
          if (first.kind === 'image') setActivePath(first.path);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(formatErr(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scan only when install/category changes
  }, [game.installPath, game.category, t]);

  const imageSequence = useMemo(
    () => buildImageSequence(selected, scopedImageItems, activePath),
    [selected, scopedImageItems, activePath],
  );

  useEffect(() => {
    return () => clearViewerPreviewCaches();
  }, []);

  const selectMediaFolder = useCallback(
    (folder: MediaFolderGroup) => {
      setActiveFolderRel(folder.relPrefix);
      const preferVideo = game.category === 'animations';
      const first =
        (preferVideo ? folder.items.find((i) => i.kind === 'video') : undefined) ??
        folder.items.find((i) => i.kind === 'image') ??
        folder.items[0];
      if (!first) return;
      if (first.kind === 'cbz') {
        void selectItem(first);
        return;
      }
      setSelected(first);
      if (first.kind === 'image') setActivePath(first.path);
    },
    [game.category, selectItem],
  );

  const imageViewActive =
    selected?.kind === 'image' ||
    (selected?.kind === 'cbz' && (selected.cbzPages?.length ?? 0) > 0);
  const videoViewActive = selected?.kind === 'video';

  const goToPage = useCallback((target: MediaViewItem) => {
    setActivePath(target.path);
    if (selected?.kind === 'image') setSelected(target);
  }, [selected?.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const doc = document as Document & { webkitFullscreenElement?: Element };
        if (
          document.fullscreenElement ||
          doc.webkitFullscreenElement ||
          document.pictureInPictureElement
        ) {
          return;
        }
        onClose();
        return;
      }
      if (!imageSequence) return;
      const { items, index: idx } = imageSequence;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        const prev = items[idx - 1];
        if (prev) goToPage(prev);
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        const next = items[idx + 1];
        if (next) goToPage(next);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        const first = items[0];
        if (first) goToPage(first);
      }
      if (e.key === 'End') {
        e.preventDefault();
        const last = items[items.length - 1];
        if (last) goToPage(last);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, imageSequence, goToPage]);

  return (
    <div className="media-viewer">
      <header className="media-viewer-head">
        <button type="button" className="media-viewer-back" onClick={onClose}>
          ← {t('mediaViewer.back')}
        </button>
        <div className="media-viewer-head-center">
          <h1 className="media-viewer-title" title={game.title}>
            {game.title}
          </h1>
          {imageSequence && (
            <span className="media-viewer-head-meta">
              {t('mediaViewer.pageOf', {
                page: imageSequence.index + 1,
                total: imageSequence.items.length,
              })}
            </span>
          )}
        </div>
        <div className="media-viewer-head-actions">
          {imageSequence && (
            <button
              type="button"
              className="media-viewer-tool"
              onClick={() => setFitMode((m) => (m === 'contain' ? 'width' : 'contain'))}
              title={t('mediaViewer.fitToggle')}
            >
              {fitMode === 'contain' ? t('mediaViewer.fitWidth') : t('mediaViewer.fitScreen')}
            </button>
          )}
          {game.installPath && (
            <button
              type="button"
              className="media-viewer-tool"
              onClick={() => openPath(game.installPath!)}
            >
              {t('mediaViewer.openFolder')}
            </button>
          )}
        </div>
      </header>

      {loading && (
        <div className="media-viewer-status">
          <LoadingState label={t('common.loading')} variant="compact" />
        </div>
      )}
      {error && <div className="media-viewer-error">{error}</div>}
      {cbzLoading && (
        <div className="media-viewer-status">
          <LoadingState label={t('mediaViewer.loadingCbz')} variant="compact" />
        </div>
      )}

      {!loading && !error && index && (
        <div className="media-viewer-body">
          <aside
            className={`media-viewer-sidebar${useFolderNav && (imageViewActive || videoViewActive) ? ' media-viewer-sidebar--split' : ''}`}
          >
            {imageViewActive && imageSequence && imageSequence.items.length > 0 ? (
              useFolderNav ? (
                <>
                  <FolderSidebar
                    folders={mediaFolders}
                    activeRel={effectiveFolderRel ?? ''}
                    onSelect={selectMediaFolder}
                  />
                  <PageSidebar
                    items={imageSequence.items}
                    activePath={imageSequence.activePath}
                    onSelect={goToPage}
                  />
                </>
              ) : (
                <PageSidebar
                  items={imageSequence.items}
                  activePath={imageSequence.activePath}
                  onSelect={goToPage}
                />
              )
            ) : videoViewActive && videoItems.length > 0 ? (
              useFolderNav ? (
                <>
                  <FolderSidebar
                    folders={mediaFolders}
                    activeRel={effectiveFolderRel ?? ''}
                    onSelect={selectMediaFolder}
                  />
                  <VideoSidebar
                    items={scopedVideoItems}
                    activePath={selected.path}
                    onSelect={selectItem}
                  />
                </>
              ) : (
                <VideoSidebar
                  items={videoItems}
                  activePath={selected.path}
                  onSelect={selectItem}
                />
              )
            ) : (
              <>
                <FileGroup
                  label={t('mediaViewer.group.images')}
                  items={imageItems}
                  selected={selected}
                  onSelect={selectItem}
                />
                <FileGroup
                  label={t('mediaViewer.group.videos')}
                  items={items.filter((i) => i.kind === 'video')}
                  selected={selected}
                  onSelect={selectItem}
                />
                <FileGroup
                  label={t('mediaViewer.group.pdfs')}
                  items={items.filter((i) => i.kind === 'pdf')}
                  selected={selected}
                  onSelect={selectItem}
                />
                <FileGroup
                  label={t('mediaViewer.group.archives')}
                  items={items.filter((i) => i.kind === 'cbz' && !i.cbzPages)}
                  selected={selected}
                  onSelect={selectItem}
                />
              </>
            )}
            {items.length === 0 && (
              <p className="media-viewer-empty">{t('mediaViewer.empty')}</p>
            )}
          </aside>
          <main className="media-viewer-stage">
            {selected ? (
              <ViewerPane
                selected={selected}
                imageSequence={imageSequence}
                fitMode={fitMode}
                onGoToPage={goToPage}
              />
            ) : (
              <p className="media-viewer-empty">{t('mediaViewer.pickFile')}</p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function FolderSidebar({
  folders,
  activeRel,
  onSelect,
}: {
  folders: MediaFolderGroup[];
  activeRel: string;
  onSelect: (folder: MediaFolderGroup) => void;
}) {
  const { t } = useT();
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeRel]);

  return (
    <div className="media-viewer-folders">
      <div className="media-viewer-pages-head">
        <span className="media-viewer-group-label">{t('mediaViewer.group.folders')}</span>
        <span className="media-viewer-pages-count">{folders.length}</span>
      </div>
      <ul className="media-viewer-folder-list">
        {folders.map((folder) => {
          const active = folder.relPrefix === activeRel;
          return (
            <li key={folder.relPrefix || '__root__'} ref={active ? activeRef : undefined}>
              <button
                type="button"
                className={`media-viewer-folder-btn${active ? ' media-viewer-folder-btn--active' : ''}`}
                onClick={() => onSelect(folder)}
                title={folder.relPrefix || folder.label}
              >
                <span className="media-viewer-folder-icon" aria-hidden />
                <span className="media-viewer-folder-name">{folder.label}</span>
                <span className="media-viewer-folder-count">{folder.items.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PageToolbar({
  index,
  total,
  onPrev,
  onNext,
  onExternal,
  disablePrev,
  disableNext,
}: {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onExternal?: () => void;
  disablePrev: boolean;
  disableNext: boolean;
}) {
  const { t } = useT();
  return (
    <div className="media-viewer-toolbar">
      <button type="button" className="media-viewer-nav-btn" disabled={disablePrev} onClick={onPrev}>
        ← {t('mediaViewer.prev')}
      </button>
      <span className="media-viewer-toolbar-page">
        {t('mediaViewer.pageOf', { page: index + 1, total })}
      </span>
      <button type="button" className="media-viewer-nav-btn" disabled={disableNext} onClick={onNext}>
        {t('mediaViewer.next')} →
      </button>
      {onExternal && (
        <button type="button" className="media-viewer-nav-secondary" onClick={onExternal}>
          {t('mediaViewer.openExternal')}
        </button>
      )}
    </div>
  );
}

function FileGroup({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: MediaViewItem[];
  selected: MediaViewItem | null;
  onSelect: (item: MediaViewItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="media-viewer-group">
      <div className="media-viewer-group-label">{label}</div>
      <ul className="media-viewer-file-list">
        {items.map((item) => (
          <li key={item.path}>
            <button
              type="button"
              className={`media-viewer-file${selected?.path === item.path ? ' media-viewer-file--active' : ''}`}
              onClick={() => onSelect(item)}
              title={item.path}
            >
              {item.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ViewerPane({
  selected,
  imageSequence,
  fitMode,
  onGoToPage,
}: {
  selected: MediaViewItem;
  imageSequence: ImageSequence | null;
  fitMode: FitMode;
  onGoToPage: (item: MediaViewItem) => void;
}) {
  const { t } = useT();

  if (selected.kind === 'video') {
    return (
      <CustomVideoPlayer
        key={selected.path}
        src={toAssetUrl(selected.path)}
        filePath={selected.path}
        title={selected.name}
      />
    );
  }

  if (selected.kind === 'pdf') {
    return <PdfView path={selected.path} />;
  }

  if (selected.kind === 'cbz' && !selected.cbzPages) {
    return (
      <div className="media-viewer-status">
        <LoadingState label={t('mediaViewer.loadingCbz')} variant="compact" />
      </div>
    );
  }

  if (imageSequence && imageSequence.items.length > 0) {
    const current = imageSequence.items[imageSequence.index];
    const prev = imageSequence.items[imageSequence.index - 1];
    const next = imageSequence.items[imageSequence.index + 1];
    return (
      <div className="media-viewer-reader">
        <div className={`media-viewer-canvas media-viewer-canvas--${fitMode}`}>
          <ReaderImage
            key={current.path}
            path={current.path}
            alt={current.name}
            fitMode={fitMode}
            fileSize={current.size}
          />
        </div>
        <PageToolbar
          index={imageSequence.index}
          total={imageSequence.items.length}
          disablePrev={!prev}
          disableNext={!next}
          onPrev={() => prev && onGoToPage(prev)}
          onNext={() => next && onGoToPage(next)}
          onExternal={() => openPath(current.path)}
        />
        <p className="media-viewer-hint">{t('mediaViewer.keyboardHint')}</p>
      </div>
    );
  }

  return <p className="media-viewer-empty">{t('mediaViewer.pickFile')}</p>;
}

function PdfView({ path }: { path: string }) {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    let cancelled = false;
    setCanvasReady(false);
    pdfjs
      .getDocument(toAssetUrl(path))
      .promise.then(async (doc) => {
        if (cancelled) return;
        setNumPages(doc.numPages);
        const safePage = Math.min(Math.max(1, page), doc.numPages);
        const p = await doc.getPage(safePage);
        if (cancelled) return;
        const viewport = p.getViewport({ scale: 1.5 });
        const ctx = node.getContext('2d');
        if (!ctx) return;
        node.width = viewport.width;
        node.height = viewport.height;
        await p.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setCanvasReady(true);
      })
      .catch(() => {
        if (!cancelled) setCanvasReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, page]);

  return (
    <div className="media-viewer-pdf">
      <div className="media-viewer-toolbar">
        <button
          type="button"
          className="media-viewer-nav-btn"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          ←
        </button>
        <span className="media-viewer-toolbar-page">
          {t('mediaViewer.pdfPage', { page: String(page), total: String(numPages || '?') })}
        </span>
        <button
          type="button"
          className="media-viewer-nav-btn"
          disabled={numPages > 0 && page >= numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </button>
        <button type="button" className="media-viewer-nav-secondary" onClick={() => openPath(path)}>
          {t('mediaViewer.openExternal')}
        </button>
      </div>
      {!canvasReady && (
        <div className="media-viewer-status">
          <LoadingState label={t('common.loading')} variant="compact" />
        </div>
      )}
      <canvas ref={canvasRef} className="media-viewer-pdf-canvas" />
    </div>
  );
}

function scopeItemsByFolder(
  kindItems: MediaViewItem[],
  folders: MediaFolderGroup[],
  useNav: boolean,
  folderRel: string | null,
): MediaViewItem[] {
  if (!useNav || folderRel === null) return kindItems;
  const folder = folders.find((f) => f.relPrefix === folderRel) ?? folders[0];
  if (!folder) return kindItems;
  return kindItems.filter((i) => folder.items.some((f) => f.path === i.path));
}

function buildImageSequence(
  selected: MediaViewItem | null,
  imageItems: MediaViewItem[],
  activePath: string | null,
): ImageSequence | null {
  if (!selected) return null;

  let items: MediaViewItem[] = [];
  if (selected.kind === 'cbz' && selected.cbzPages?.length) {
    items = selected.cbzPages.map((p, i) => ({
      kind: 'image' as const,
      path: p,
      name: pageLabel(p, i + 1),
    }));
  } else if (selected.kind === 'image' && imageItems.length > 0) {
    items = imageItems;
  } else {
    return null;
  }

  const path = activePath && items.some((i) => i.path === activePath) ? activePath : items[0].path;
  const index = items.findIndex((i) => i.path === path);
  return {
    items,
    index: index >= 0 ? index : 0,
    activePath: path,
  };
}

function toAssetUrl(path: string): string {
  return convertFileSrc(path);
}

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
