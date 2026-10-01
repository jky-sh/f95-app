import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import * as pdfjs from 'pdfjs-dist';
import * as ipc from '../../../lib/ipc';
import * as library from '../../../lib/library';
import { useT, type TFunction } from '../../../lib/i18n';
import { buildMediaItems, pageLabel } from '../../../lib/mediaItems';
import { groupMediaIntoFolders } from '../../../lib/mediaFolders';
import { directAssetUrl, resolvePreviewPath, THUMB_SKIP_BYTES, upgradeDisplayUrl } from '../../../lib/mediaPreview';
import { sortPaths } from '../../../lib/naturalSort';
import { formatBytes } from '../../../types/download';
import type { InstallMediaIndex, MediaViewItem } from '../../../types/media';
import type { LibraryGame } from '../../../types/library';
import { Icon } from '../../ui/Icon';
import { useBp } from '../BpContext';
import type { BpAction } from '../bpInput';
import { BpArrowsGlyph, BpGlyph } from '../BpGlyph';
import { BpEmpty, BpGrid, BpHeading, BpLoader } from '../BpParts';
import { playSound } from '../bpSound';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

/** A readable unit: a folder of images, a comic archive or a PDF. */
interface Chapter {
  key: string;
  label: string;
  kind: 'pages' | 'cbz' | 'pdf';
  pages: MediaViewItem[];
  /** The archive or PDF file. */
  file?: MediaViewItem;
}

type Open =
  | { kind: 'pages'; chapter: Chapter; pages: MediaViewItem[]; start: number }
  | { kind: 'pdf'; chapter: Chapter }
  | { kind: 'video'; start: number };

interface Resume {
  chapter: string;
  page: number;
}

const resumeKey = (threadId: string) => `f95app.bp.read.${threadId}`;

/** "1 page" / "12 pages": the `.one` key for a single item. */
function countLabel(t: TFunction, key: string, count: number): string {
  return count === 1 ? t(`${key}.one`) : t(key, { count });
}
const VOLUME_KEY = 'f95app.mediaViewer.volume';
const CHROME_MS = 2600;

function loadResume(threadId: string): Resume | null {
  try {
    const raw = localStorage.getItem(resumeKey(threadId));
    return raw ? (JSON.parse(raw) as Resume) : null;
  } catch {
    return null;
  }
}

function saveResume(threadId: string, resume: Resume): void {
  try {
    localStorage.setItem(resumeKey(threadId), JSON.stringify(resume));
  } catch {
    /* storage off */
  }
}

/** A thumbnail for a local image: the original when small, a cached preview otherwise. */
function useLocalThumb(item: MediaViewItem | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!item) {
      setSrc(null);
      return;
    }
    if (item.size != null && item.size <= THUMB_SKIP_BYTES) {
      setSrc(directAssetUrl(item.path));
      return;
    }
    let cancelled = false;
    resolvePreviewPath(item.path, 'thumb')
      .then((path) => {
        if (!cancelled) setSrc(path ? convertFileSrc(path) : directAssetUrl(item.path));
      })
      .catch(() => {
        if (!cancelled) setSrc(directAssetUrl(item.path));
      });
    return () => {
      cancelled = true;
    };
  }, [item]);
  return src;
}

/**
 * Comics and animations in Big Picture: chapters and videos to pick from,
 * then a full-screen reader (pages, archives, PDFs) or player driven by the
 * controller, picking up where the last reading stopped.
 */
export function BpMedia({ threadId, active }: { threadId: string; active: boolean }) {
  const { t } = useT();
  const bp = useBp();
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [index, setIndex] = useState<InstallMediaIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [resume, setResume] = useState<Resume | null>(() => loadResume(threadId));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const g = await library.get(threadId);
        if (cancelled) return;
        if (!g) {
          setError(t('bp.game.missing'));
          return;
        }
        setGame(g);
        if (!g.installPath) {
          setError(t('mediaViewer.noInstallPath'));
          return;
        }
        const idx = await ipc.scanInstallMedia({ installPath: g.installPath, category: g.category });
        if (!cancelled) setIndex(idx);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, t]);

  useEffect(() => bp.setBackdrop(game?.thumbnailUrl ?? null), [bp, game?.thumbnailUrl]);

  const { chapters, videos } = useMemo(() => {
    if (!index || !game?.installPath) return { chapters: [] as Chapter[], videos: [] as MediaViewItem[] };
    const items = buildMediaItems(index);
    const images = items.filter((i) => i.kind === 'image');
    const folders = groupMediaIntoFolders(images, game.installPath, t('mediaViewer.folder.root'));
    const out: Chapter[] = folders.map((f) => ({
      key: `dir:${f.relPrefix}`,
      label: f.label,
      kind: 'pages' as const,
      pages: f.items,
    }));
    for (const file of items) {
      if (file.kind === 'cbz') out.push({ key: `cbz:${file.path}`, label: file.name, kind: 'cbz', pages: [], file });
      if (file.kind === 'pdf') out.push({ key: `pdf:${file.path}`, label: file.name, kind: 'pdf', pages: [], file });
    }
    return { chapters: out, videos: items.filter((i) => i.kind === 'video') };
  }, [index, game?.installPath, t]);

  const openChapter = useCallback(
    async (chapter: Chapter, page = 0) => {
      playSound('open');
      if (chapter.kind === 'pdf') {
        setOpen({ kind: 'pdf', chapter });
        return;
      }
      if (chapter.kind === 'cbz' && chapter.file) {
        setExtracting(true);
        try {
          const preview = await ipc.extractCbzPreview({ archivePath: chapter.file.path, maxPages: 300 });
          const pages = sortPaths(preview.pages).map((path, i) => ({
            kind: 'image' as const,
            path,
            name: pageLabel(path, i + 1),
          }));
          setOpen({ kind: 'pages', chapter, pages, start: Math.min(page, Math.max(0, pages.length - 1)) });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setExtracting(false);
        }
        return;
      }
      setOpen({ kind: 'pages', chapter, pages: chapter.pages, start: Math.min(page, chapter.pages.length - 1) });
    },
    [],
  );

  const onPage = useCallback(
    (chapter: Chapter, page: number) => {
      const next = { chapter: chapter.key, page };
      saveResume(threadId, next);
      setResume(next);
    },
    [threadId],
  );

  const close = useCallback(() => {
    playSound('back');
    setOpen(null);
  }, []);

  if (error) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpEmpty
          icon="alert"
          title={error}
          action={
            <button type="button" className="bp-btn bp-focusable" data-bp-autofocus="" onClick={bp.back}>
              {t('bp.hint.back')}
            </button>
          }
        />
      </div>
    );
  }
  if (!game || !index) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpLoader label={t('common.loading')} />
      </div>
    );
  }

  const resumeChapter = resume ? chapters.find((c) => c.key === resume.chapter) : undefined;
  const isVideo = game.category === 'animations' && videos.length > 0;
  const totalPages = chapters.reduce((sum, c) => sum + c.pages.length, 0);
  const nothing = chapters.length === 0 && videos.length === 0;

  const host = bp.layerHost();
  const layer =
    open && active && host
      ? createPortal(
          open.kind === 'video' ? (
            <BpPlayer videos={videos} start={open.start} title={game.title} onClose={close} />
          ) : open.kind === 'pdf' ? (
            <BpPdfReader chapter={open.chapter} title={game.title} onClose={close} />
          ) : (
            <BpReader
              title={game.title}
              chapter={open.chapter}
              pages={open.pages}
              start={open.start}
              onPage={(page) => onPage(open.chapter, page)}
              onClose={close}
            />
          ),
          host,
        )
      : null;

  return (
    <div className="bp-screen-body bp-page bp-media" data-bp-scroll-y="">
      <header className="bp-media-head" data-bp-snap="top">
        <h1 className="bp-page-title">{game.title}</h1>
        <div className="bp-meta">
          {chapters.length > 0 && <span>{countLabel(t, 'bp.media.chapters', chapters.length)}</span>}
          {totalPages > 0 && <span>{countLabel(t, 'bp.media.pages', totalPages)}</span>}
          {videos.length > 0 && <span>{countLabel(t, 'bp.media.videos', videos.length)}</span>}
        </div>
        {!nothing && (
          <div className="bp-actions" data-bp-group="media-actions" data-bp-row="">
            {isVideo ? (
              <button
                type="button"
                className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
                data-bp-autofocus=""
                onClick={() => {
                  playSound('open');
                  setOpen({ kind: 'video', start: 0 });
                }}
              >
                <Icon name="play" size={20} />
                {t('bp.media.watch')}
              </button>
            ) : resumeChapter ? (
              <button
                type="button"
                className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
                data-bp-autofocus=""
                onClick={() => void openChapter(resumeChapter, resume!.page)}
              >
                <Icon name="book" size={20} />
                {t('bp.media.resume', { chapter: resumeChapter.label, page: resume!.page + 1 })}
              </button>
            ) : (
              chapters[0] && (
                <button
                  type="button"
                  className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
                  data-bp-autofocus=""
                  onClick={() => void openChapter(chapters[0])}
                >
                  <Icon name="book" size={20} />
                  {t('bp.media.start')}
                </button>
              )
            )}
            {game.installPath && (
              <button type="button" className="bp-btn bp-focusable" onClick={() => void openPath(game.installPath!)}>
                <Icon name="folder" size={20} />
                {t('mediaViewer.openFolder')}
              </button>
            )}
          </div>
        )}
      </header>

      {nothing && <BpEmpty icon="image" title={t('mediaViewer.empty')} />}
      {extracting && <BpLoader label={t('mediaViewer.loadingCbz')} />}

      {videos.length > 0 && (
        <section>
          <BpHeading title={t('mediaViewer.group.videos')} count={videos.length} />
          <div className="bp-video-list">
            {videos.map((v, i) => (
              <button
                key={v.path}
                type="button"
                className="bp-video-row bp-focusable"
                data-bp-a={t('bp.media.watch')}
                onClick={() => {
                  playSound('open');
                  setOpen({ kind: 'video', start: i });
                }}
              >
                <span className="bp-video-num">{i + 1}</span>
                <Icon name="play" size={18} />
                <span className="bp-video-name">{v.name}</span>
                {v.size != null && <span className="bp-video-size">{formatBytes(v.size)}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {chapters.length > 0 && (
        <section>
          <BpHeading
            title={game.category === 'comics' ? t('bp.media.chapterList') : t('mediaViewer.group.images')}
            count={chapters.length}
          />
          <BpGrid className="bp-chapters">
            {chapters.map((c, i) => (
              <ChapterTile
                key={c.key}
                chapter={c}
                index={i}
                current={c.key === resume?.chapter}
                onOpen={() => void openChapter(c, c.key === resume?.chapter ? resume.page : 0)}
              />
            ))}
          </BpGrid>
        </section>
      )}
      {layer}
    </div>
  );
}

function ChapterTile({
  chapter,
  index,
  current,
  onOpen,
}: {
  chapter: Chapter;
  index: number;
  current: boolean;
  onOpen: () => void;
}) {
  const { t } = useT();
  const thumb = useLocalThumb(chapter.pages[0]);
  return (
    <button
      type="button"
      className="bp-tile bp-chapter bp-focusable"
      style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
      data-bp-a={t('bp.media.read')}
      onClick={onOpen}
    >
      <span className="bp-tile-art bp-chapter-art">
        {thumb ? (
          <img src={thumb} alt="" draggable={false} loading="lazy" />
        ) : (
          <Icon name={chapter.kind === 'pdf' ? 'book' : 'image'} size={40} strokeWidth={1.5} />
        )}
        {current && <span className="bp-badge bp-badge--info">{t('bp.media.reading')}</span>}
      </span>
      <span className="bp-tile-caption">
        <span className="bp-tile-title">{chapter.label}</span>
        <span className="bp-tile-sub">
          {chapter.kind === 'pages'
            ? countLabel(t, 'bp.media.pages', chapter.pages.length)
            : chapter.kind === 'pdf'
              ? 'PDF'
              : 'CBZ'}
        </span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------------- */
/* Shared: controller ownership and auto-hiding chrome                         */
/* ------------------------------------------------------------------------- */

/** Routes the controller to `handle` while mounted; the chrome shows on any input. */
function useLayerControls(handle: (action: BpAction) => boolean) {
  const bp = useBp();
  const [chrome, setChrome] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const handleRef = useRef(handle);
  handleRef.current = handle;

  const wake = useCallback(() => {
    setChrome(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChrome(false), CHROME_MS);
  }, []);

  useEffect(() => {
    wake();
    bp.setActionHandler((action) => {
      wake();
      return handleRef.current(action);
    });
    return () => {
      bp.setActionHandler(null);
      window.clearTimeout(timer.current);
    };
  }, [bp, wake]);

  return { chrome, wake };
}

/** The file behind a page, swapped for a lighter preview when it is huge. */
function usePageUrl(item: MediaViewItem | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!item) {
      setSrc(null);
      return;
    }
    const direct = directAssetUrl(item.path);
    setSrc(direct);
    if (!item.size) return;
    let cancelled = false;
    void upgradeDisplayUrl(item.path, item.size).then((url) => {
      if (!cancelled && url && url !== direct) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [item]);
  return src;
}

/* ------------------------------------------------------------------------- */
/* Page reader                                                                */
/* ------------------------------------------------------------------------- */

function BpReader({
  title,
  chapter,
  pages,
  start,
  onPage,
  onClose,
}: {
  title: string;
  chapter: Chapter;
  pages: MediaViewItem[];
  start: number;
  onPage: (page: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [index, setIndex] = useState(Math.max(0, start));
  const [fit, setFit] = useState<'height' | 'width'>('height');
  const stageRef = useRef<HTMLDivElement>(null);
  const page = pages[index];
  const src = usePageUrl(page);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= pages.length) {
        playSound('edge');
        return;
      }
      playSound('page');
      setIndex(to);
    },
    [pages.length],
  );

  useEffect(() => {
    onPage(index);
    stageRef.current?.scrollTo({ top: 0 });
    // The next pages are ready before they are needed.
    for (const next of pages.slice(index + 1, index + 3)) {
      const img = new Image();
      img.src = directAssetUrl(next.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const { chrome, wake } = useLayerControls((action) => {
    const stage = stageRef.current;
    switch (action) {
      case 'left':
      case 'prevTab':
        go(index - 1);
        return true;
      case 'right':
      case 'nextTab':
      case 'accept':
        go(index + 1);
        return true;
      case 'up':
      case 'down':
        if (fit === 'width' && stage) {
          stage.scrollBy({ top: (action === 'down' ? 1 : -1) * stage.clientHeight * 0.6, behavior: 'smooth' });
        }
        return true;
      case 'options':
        setFit((f) => (f === 'height' ? 'width' : 'height'));
        playSound('toggle');
        return true;
      case 'back':
        onClose();
        return true;
      default:
        return true;
    }
  });

  return (
    <div
      className="bp-layer bp-reader"
      data-bp-layer=""
      data-fit={fit}
      data-chrome={chrome || undefined}
      onMouseMove={wake}
    >
      <div
        className="bp-reader-stage"
        ref={stageRef}
        data-bp-scroll-y=""
        onClick={(e) => {
          const half = e.clientX < window.innerWidth / 2;
          go(index + (half ? -1 : 1));
        }}
      >
        {src && <img key={page.path} src={src} alt={page.name} draggable={false} />}
      </div>
      <div className="bp-reader-top">
        <span className="bp-reader-title">{title}</span>
        <span className="bp-reader-sub">{chapter.label}</span>
      </div>
      <div className="bp-reader-bottom">
        <span className="bp-reader-count">{t('mediaViewer.pageOf', { page: index + 1, total: pages.length })}</span>
        <span className="bp-reader-progress" aria-hidden>
          <span style={{ width: `${((index + 1) / pages.length) * 100}%` }} />
        </span>
        <span className="bp-reader-hints">
          <span>
            <BpArrowsGlyph /> {t('bp.media.turn')}
          </span>
          <span>
            <BpGlyph action="options" /> {fit === 'height' ? t('mediaViewer.fitWidth') : t('mediaViewer.fitScreen')}
          </span>
          <span>
            <BpGlyph action="back" /> {t('bp.hint.back')}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* PDF reader                                                                 */
/* ------------------------------------------------------------------------- */

function BpPdfReader({ chapter, title, onClose }: { chapter: Chapter; title: string; onClose: () => void }) {
  const { t } = useT();
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    void pdfjs
      .getDocument(convertFileSrc(chapter.file!.path))
      .promise.then((doc) => {
        if (cancelled) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chapter]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === 0) return;
    let cancelled = false;
    setReady(false);
    void doc.getPage(page).then(async (p) => {
      if (cancelled) return;
      // Sharp at the screen's height (and density).
      const base = p.getViewport({ scale: 1 });
      const scale = (window.innerHeight * window.devicePixelRatio) / base.height;
      const viewport = p.getViewport({ scale });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await p.render({ canvasContext: ctx, viewport }).promise;
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [page, pageCount]);

  const go = (to: number) => {
    if (to < 1 || to > pageCount) {
      playSound('edge');
      return;
    }
    playSound('page');
    setPage(to);
  };

  const { chrome, wake } = useLayerControls((action) => {
    if (action === 'left' || action === 'prevTab') go(page - 1);
    else if (action === 'right' || action === 'nextTab' || action === 'accept') go(page + 1);
    else if (action === 'back') onClose();
    return true;
  });

  return (
    <div className="bp-layer bp-reader" data-bp-layer="" data-fit="height" data-chrome={chrome || undefined} onMouseMove={wake}>
      <div className="bp-reader-stage">
        <canvas ref={canvasRef} className="bp-reader-canvas" data-ready={ready || undefined} />
        {!ready && <BpLoader />}
      </div>
      <div className="bp-reader-top">
        <span className="bp-reader-title">{title}</span>
        <span className="bp-reader-sub">{chapter.label}</span>
      </div>
      <div className="bp-reader-bottom">
        <span className="bp-reader-count">
          {t('mediaViewer.pdfPage', { page: String(page), total: String(pageCount || '?') })}
        </span>
        <span className="bp-reader-progress" aria-hidden>
          <span style={{ width: pageCount ? `${(page / pageCount) * 100}%` : 0 }} />
        </span>
        <span className="bp-reader-hints">
          <span>
            <BpArrowsGlyph /> {t('bp.media.turn')}
          </span>
          <span>
            <BpGlyph action="back" /> {t('bp.hint.back')}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Video player                                                               */
/* ------------------------------------------------------------------------- */

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? v : 1;
  } catch {
    return 1;
  }
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const SEEK_S = 10;

function BpPlayer({
  videos,
  start,
  title,
  onClose,
}: {
  videos: MediaViewItem[];
  start: number;
  title: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(start);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(readVolume);
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const video = videos[index];

  const say = useCallback((text: string) => {
    setFlash({ id: Date.now(), text });
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* storage off */
    }
  }, [volume]);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= videos.length) {
        playSound('edge');
        return;
      }
      playSound('page');
      setIndex(to);
      setTime(0);
      setDuration(0);
    },
    [videos.length],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seek = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration);
      say(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}s`);
    },
    [say],
  );

  const { chrome, wake } = useLayerControls((action) => {
    switch (action) {
      case 'accept':
        togglePlay();
        return true;
      case 'left':
        seek(-SEEK_S);
        return true;
      case 'right':
        seek(SEEK_S);
        return true;
      case 'up':
      case 'down': {
        const next = Math.min(1, Math.max(0, Math.round((volume + (action === 'up' ? 0.1 : -0.1)) * 10) / 10));
        setVolume(next);
        say(t('bp.media.volume', { pct: Math.round(next * 100) }));
        return true;
      }
      case 'prevTab':
        go(index - 1);
        return true;
      case 'nextTab':
        go(index + 1);
        return true;
      case 'back':
        onClose();
        return true;
      default:
        return true;
    }
  });

  return (
    <div
      className="bp-layer bp-player"
      data-bp-layer=""
      data-chrome={chrome || !playing || undefined}
      onMouseMove={wake}
    >
      <video
        ref={videoRef}
        key={video.path}
        className="bp-player-video"
        src={convertFileSrc(video.path)}
        autoPlay
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          e.currentTarget.volume = volume;
          setDuration(e.currentTarget.duration);
        }}
        onEnded={() => {
          if (index < videos.length - 1) go(index + 1);
        }}
      />
      {flash && (
        <div key={flash.id} className="bp-player-flash">
          {flash.text}
        </div>
      )}
      {!playing && (
        <div className="bp-player-paused" aria-hidden>
          <Icon name="play" size={64} />
        </div>
      )}
      <div className="bp-reader-top">
        <span className="bp-reader-title">{title}</span>
        <span className="bp-reader-sub">
          {video.name} · {t('bp.media.videoOf', { n: index + 1, total: videos.length })}
        </span>
      </div>
      <div className="bp-reader-bottom">
        <span className="bp-reader-count">
          {clock(time)} / {clock(duration)}
        </span>
        <span className="bp-reader-progress" aria-hidden>
          <span style={{ width: duration ? `${(time / duration) * 100}%` : 0 }} />
        </span>
        <span className="bp-reader-hints">
          <span>
            <BpGlyph action="accept" /> {playing ? t('mediaViewer.pause') : t('mediaViewer.play')}
          </span>
          <span>
            <BpArrowsGlyph /> {t('bp.media.seek')}
          </span>
          <span>
            <BpGlyph action="prevTab" /> <BpGlyph action="nextTab" /> {t('bp.media.otherVideo')}
          </span>
          <span>
            <BpGlyph action="back" /> {t('bp.hint.back')}
          </span>
        </span>
      </div>
    </div>
  );
}
