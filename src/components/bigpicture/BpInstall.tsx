import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useDownloads, type FileChoiceRequest } from '../../contexts/Downloads';
import { useOffline } from '../../contexts/Offline';
import type { ThreadDownload } from '../../hooks/useDownloadsByThread';
import { dialog } from '../../lib/dialog';
import { HOST_COLORS, STREAMABLE_HOSTS, groupDownloads, shouldShowHostBadge } from '../../lib/downloadHosts';
import { loadGameDetail } from '../../lib/gameDetailCache';
import type { GameDownloadModalDetail } from '../../lib/gameDownloadModal';
import { useT } from '../../lib/i18n';
import { describeIpcError } from '../../lib/ipcError';
import * as libraries from '../../lib/libraries';
import {
  currentOs,
  groupFitsOs,
  inferPlatformLabel,
  pickRecommendedFileId,
  sortFilesForGroup,
} from '../../lib/platformMatch';
import { startGameDownload } from '../../lib/startGameDownload';
import { formatBytes } from '../../types/download';
import type { GameDetail, GameDownload } from '../../types/game';
import type { InstallLibraryWithDisk } from '../../types/install-library';
import { LibraryCover } from '../library/LibraryCover';
import { Icon } from '../ui/Icon';
import { useBp, useBpGames } from './BpContext';
import { BpLoader } from './BpParts';
import { playSound } from './bpSound';

type Step =
  | { kind: 'source' }
  | { kind: 'library'; download: GameDownload; libs: InstallLibraryWithDisk[] };

interface SourceGroup {
  /** The thread's section ("Win/Linux", "Mac", "Extras"); null before any. */
  label: string | null;
  items: GameDownload[];
  /** The section for this computer, listed first. */
  recommended: boolean;
}

/**
 * Installing or updating without leaving Big Picture (`openGameDownloadModal`
 * lands here while it is open): the thread's links by section, the one for
 * this computer first, then where to put the game when there is more than
 * one library. Failures show in the panel, so another link is one press away.
 */
export function BpInstall({
  request,
  backRef,
  onClose,
}: {
  request: GameDownloadModalDetail;
  /** B: true when it stepped back to the links instead of closing. */
  backRef: MutableRefObject<(() => boolean) | null>;
  /** `started`: the download is on its way (no dismiss sound). */
  onClose: (started: boolean) => void;
}) {
  const { t } = useT();
  const bp = useBp();
  const games = useBpGames();
  const { isOffline } = useOffline();
  const [detail, setDetail] = useState<GameDetail | null>(request.detail ?? null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<Step>({ kind: 'source' });
  /** What is being handed to the downloader: a link's url, or `lib:<id>`. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The link that led to the libraries, focused again on the way back. */
  const [picked, setPicked] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (request.detail || isOffline) return;
    let cancelled = false;
    setLoadError(null);
    loadGameDetail(request.threadId, { fresh: attempt > 0 })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err ?? 'unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, [request, isOffline, attempt]);

  useEffect(() => {
    backRef.current = () => {
      if (step.kind !== 'library' || busy) return false;
      setStep({ kind: 'source' });
      return true;
    };
    return () => {
      backRef.current = null;
    };
  });

  const groups = useMemo<SourceGroup[]>(() => {
    if (!detail) return [];
    const os = currentOs();
    const list = groupDownloads(detail.downloads).map(([label, items]) => ({ label, items, recommended: false }));
    const mine = list.findIndex((g) => g.label != null && groupFitsOs(g.label, os));
    if (mine >= 0) {
      const [group] = list.splice(mine, 1);
      list.unshift({ ...group, recommended: true });
    }
    return list;
  }, [detail]);

  const firstLinks = groups[0]?.items ?? [];
  const startUrl = picked ?? (firstLinks.find((d) => STREAMABLE_HOSTS.has(d.host)) ?? firstLinks[0])?.url ?? null;

  async function begin(download: GameDownload, libraryPath: string | undefined, key: string) {
    if (!detail) return;
    setBusy(key);
    setError(null);
    try {
      await startGameDownload(
        {
          threadId: detail.threadId,
          category: request.category,
          title: detail.title,
          threadUrl: detail.threadUrl,
          thumbnailUrl: detail.bannerUrl,
          version: detail.version,
        },
        download,
        libraryPath,
      );
      request.onStarted?.();
      if (mounted.current) onClose(true);
    } catch (err) {
      const message = t('dl.start.failed', { error: describeIpcError(err, t) });
      if (!mounted.current) {
        void dialog.alert(message, { kind: 'error' });
        return;
      }
      setError(message);
      setBusy(null);
    }
  }

  async function pick(download: GameDownload) {
    if (busy) return;
    setPicked(download.url);
    if (isOffline) {
      setError(t('offline.actionBlocked'));
      return;
    }
    setBusy(download.url);
    setError(null);
    try {
      await libraries.ensureSeeded();
      const libs = await libraries.listWithDisk();
      if (!mounted.current) return;
      if (libs.length > 1) {
        setBusy(null);
        setStep({ kind: 'library', download, libs });
        return;
      }
      await begin(download, libs[0]?.path, download.url);
    } catch (err) {
      if (!mounted.current) return;
      setError(t('dl.start.failed', { error: describeIpcError(err, t) }));
      setBusy(null);
    }
  }

  const isUpdate = request.mode === 'update';
  const version = request.versionLabel ?? detail?.version ?? null;
  const title = isUpdate
    ? t('modal.gdl.updateTitle', { title: request.title })
    : t('modal.gdl.installTitle', { title: request.title });
  const hint =
    step.kind === 'library'
      ? t('bp.install.where')
      : isUpdate && version
        ? t('modal.gdl.updateHint', { version })
        : t('modal.gdl.installHint');
  const art = detail?.bannerUrl ?? games?.find((g) => g.threadId === request.threadId)?.thumbnailUrl ?? null;

  let body: React.ReactNode;
  if (!detail) {
    body =
      loadError != null || isOffline ? (
        <div className="bp-install-state">
          <Icon name="alert" size={40} strokeWidth={1.5} />
          <p>
            {isOffline
              ? t('offline.actionBlocked')
              : t('modal.gdl.loadFailed', { error: describeIpcError(loadError, t) })}
          </p>
          <div className="bp-actions" data-bp-group="install-state" data-bp-row="">
            {!isOffline && (
              <button
                type="button"
                className="bp-btn bp-btn--primary bp-focusable"
                data-bp-autofocus=""
                onClick={() => {
                  setLoadError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('bp.store.retry')}
              </button>
            )}
            <button
              type="button"
              className="bp-btn bp-focusable"
              onClick={() => {
                onClose(false);
                bp.push({ screen: 'storeGame', threadId: request.threadId, category: request.category });
              }}
            >
              {t('modal.gdl.openStore')}
            </button>
          </div>
        </div>
      ) : (
        <div className="bp-install-state">
          <BpLoader label={t('common.loading')} />
        </div>
      );
  } else if (step.kind === 'library') {
    const chosen = step.download;
    const chosenLabel = chosen.text?.trim() || chosen.host;
    body = (
      <>
        <p className="bp-install-picked">
          <span className="bp-install-dot" style={{ background: HOST_COLORS[chosen.host] ?? 'var(--bp-ink-3)' }} />
          {chosen.group ? `${chosenLabel} · ${chosen.group}` : chosenLabel}
        </p>
        <div className="bp-install-rows" data-bp-group="install-libs">
          {step.libs.map((lib) => {
            const off = !lib.disk.available;
            const key = `lib:${lib.id}`;
            return (
              <button
                key={lib.id}
                type="button"
                className="bp-install-row bp-focusable"
                aria-disabled={off || busy != null || undefined}
                aria-busy={busy === key || undefined}
                data-bp-autofocus={lib.isDefault || undefined}
                data-bp-a={t('modal.install.confirm')}
                title={off ? t('settings.libraries.unavailable') : lib.path}
                onClick={() => {
                  if (!off && !busy) void begin(chosen, lib.path, key);
                }}
              >
                <Icon name="hardDrive" size={24} />
                <span className="bp-install-row-text">
                  <span className="bp-install-row-name">
                    {lib.label}
                    {lib.isDefault && <span className="bp-badge">{t('settings.libraries.default')}</span>}
                    {off && <span className="bp-badge bp-badge--danger">{t('settings.libraries.offline')}</span>}
                  </span>
                  <span className="bp-install-row-sub bp-install-row-sub--path">{lib.path}</span>
                </span>
                <span className="bp-install-row-aside">
                  {busy === key ? (
                    <span className="bp-spinner" aria-hidden />
                  ) : off ? (
                    '—'
                  ) : (
                    t('bp.install.free', { size: libraries.formatFreeSpace(lib.disk.freeBytes) })
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  } else if (groups.length === 0) {
    body = (
      <div className="bp-install-state">
        <p>{t('dl.empty')}</p>
        <div className="bp-actions" data-bp-group="install-state" data-bp-row="">
          <button
            type="button"
            className="bp-btn bp-focusable"
            data-bp-autofocus=""
            onClick={() => void openUrl(detail.threadUrl)}
          >
            <Icon name="external" size={20} />
            {t('bp.store.openThread')}
          </button>
        </div>
      </div>
    );
  } else {
    body = groups.map((group, gi) => (
      <section key={group.label ?? '-'} className="bp-install-group">
        {group.label && (
          <h3 className="bp-install-group-title">
            {group.label}
            {group.recommended && (
              <span className="bp-install-rec">
                <Icon name="check" size={14} strokeWidth={3} />
                {t('bp.install.recommended')}
              </span>
            )}
          </h3>
        )}
        <div className="bp-hosts" data-bp-group={`install-${gi}`} data-bp-row="">
          {group.items.map((download) => (
            <HostTile
              key={`${download.group ?? ''}\0${download.url}`}
              download={download}
              autoFocus={download.url === startUrl}
              busy={busy === download.url}
              disabled={busy != null}
              onPick={(d) => void pick(d)}
            />
          ))}
        </div>
      </section>
    ));
  }

  return (
    <div
      className="bp-layer bp-install-layer"
      data-bp-layer=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <section className="bp-install" role="dialog" aria-modal="true" aria-label={title}>
        <header className="bp-install-head">
          <span className="bp-install-art">
            <LibraryCover url={art} title={request.title} quality="preview" />
          </span>
          <span className="bp-install-heading">
            <span className="bp-install-title">{title}</span>
            <span className="bp-install-sub">{hint}</span>
          </span>
          <button
            type="button"
            className="bp-install-close"
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
            onClick={() => onClose(false)}
          >
            <Icon name="x" size={22} />
          </button>
        </header>
        {error && (
          <p className="bp-install-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
          </p>
        )}
        <div className="bp-install-body" data-bp-scroll-y="" key={step.kind}>
          {body}
        </div>
      </section>
    </div>
  );
}

function HostTile({
  download,
  autoFocus,
  busy,
  disabled,
  onPick,
}: {
  download: GameDownload;
  autoFocus: boolean;
  busy: boolean;
  disabled: boolean;
  onPick: (download: GameDownload) => void;
}) {
  const { t } = useT();
  const label = download.text?.trim() || download.host;
  const inApp = STREAMABLE_HOSTS.has(download.host);
  return (
    <button
      type="button"
      className="bp-host bp-focusable"
      style={{ '--host': HOST_COLORS[download.host] ?? 'var(--bp-ink-3)' } as React.CSSProperties}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      data-bp-autofocus={autoFocus || undefined}
      data-bp-a={t('dl.btn.download')}
      title={
        inApp
          ? t('dl.btn.tooltipSupported', { host: download.host })
          : t('dl.btn.tooltipUnsupported', { host: download.host })
      }
      onClick={() => {
        if (!disabled) onPick(download);
      }}
    >
      <span className="bp-host-name">{label}</span>
      <span className="bp-host-sub">
        {shouldShowHostBadge(label, download.host) && <span className="bp-host-tag">{download.host}</span>}
        {busy ? t('bp.install.starting') : inApp ? t('bp.install.inApp') : t('bp.install.viaBrowser')}
      </span>
      {busy && <span className="bp-spinner bp-host-spinner" aria-hidden />}
    </button>
  );
}

/** What B needs from the file chooser while it is up. */
export interface FileChoiceControl {
  busy: boolean;
  /** Cancels the waiting download (with the close sound). */
  cancel: () => void;
}

/**
 * Asks with BpFileChoice whenever a download needs one of several files
 * picked. Its own component so download progress (the same context) does
 * not re-render all of Big Picture; `onChange` reports which download asks.
 */
export function BpFileChoiceHost({
  onChange,
  controlRef,
}: {
  onChange: (downloadId: number | null) => void;
  controlRef: MutableRefObject<FileChoiceControl | null>;
}) {
  const { fileChoice, fileChoiceBusy, confirmFileChoice, cancelFileChoice } = useDownloads();
  const downloadId = fileChoice?.downloadId ?? null;

  useLayoutEffect(() => onChange(downloadId), [downloadId, onChange]);
  useLayoutEffect(() => {
    controlRef.current = fileChoice
      ? {
          busy: fileChoiceBusy,
          cancel: () => {
            playSound('close');
            void cancelFileChoice();
          },
        }
      : null;
  });

  if (!fileChoice) return null;
  return (
    <BpFileChoice
      key={fileChoice.downloadId}
      choice={fileChoice}
      busy={fileChoiceBusy}
      onPick={(id) => void confirmFileChoice(id)}
      onCancel={() => controlRef.current?.cancel()}
    />
  );
}

/**
 * A link that holds one file per system (or several parts): which to
 * download. Shows up over any screen when the downloader asks; B cancels
 * the download, like closing the desktop dialog does.
 */
function BpFileChoice({
  choice,
  busy,
  onPick,
  onCancel,
}: {
  choice: FileChoiceRequest;
  busy: boolean;
  onPick: (choiceId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const games = useBpGames();
  const game = games?.find((g) => g.threadId === choice.threadId);
  const files = useMemo(() => sortFilesForGroup(choice.files, choice.platformGroup), [choice]);
  const recommended = useMemo(
    () => pickRecommendedFileId(files, choice.platformGroup, choice.recommendedFileId),
    [files, choice],
  );
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div
      className="bp-layer bp-install-layer"
      data-bp-layer=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <section className="bp-install" role="dialog" aria-modal="true" aria-label={t('modal.hostFile.title')}>
        <header className="bp-install-head">
          <span className="bp-install-art">
            <LibraryCover url={game?.thumbnailUrl ?? null} title={game?.title ?? choice.host} quality="preview" />
          </span>
          <span className="bp-install-heading">
            <span className="bp-install-title">{game ? `${t('modal.hostFile.title')} · ${game.title}` : t('modal.hostFile.title')}</span>
            <span className="bp-install-sub">
              {t('modal.hostFile.description', { host: choice.host, count: files.length })}
            </span>
          </span>
        </header>
        <div className="bp-install-body" data-bp-scroll-y="">
          {choice.platformGroup && (
            <p className="bp-install-picked">{t('modal.hostFile.sectionHint', { group: choice.platformGroup })}</p>
          )}
          <div className="bp-install-rows" data-bp-group="file-choice">
            {files.map((file) => {
              const platform = file.platformLabel ?? inferPlatformLabel(file.fileName);
              const isRecommended = file.id === recommended && choice.platformGroup != null;
              return (
                <button
                  key={file.id}
                  type="button"
                  className="bp-install-row bp-focusable"
                  aria-disabled={busy || undefined}
                  aria-busy={(busy && picked === file.id) || undefined}
                  data-bp-autofocus={file.id === recommended || undefined}
                  data-bp-a={t('dl.btn.download')}
                  onClick={() => {
                    if (busy) return;
                    setPicked(file.id);
                    onPick(file.id);
                  }}
                >
                  <Icon name="download" size={22} />
                  <span className="bp-install-row-text">
                    <span className="bp-install-row-name bp-install-row-name--file">
                      {file.fileName}
                      {isRecommended && (
                        <span className="bp-badge bp-badge--good">{t('modal.hostFile.recommended')}</span>
                      )}
                    </span>
                    {platform && <span className="bp-install-row-sub">{platform}</span>}
                  </span>
                  <span className="bp-install-row-aside">
                    {busy && picked === file.id ? <span className="bp-spinner" aria-hidden /> : formatBytes(file.fileSize)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="bp-install-foot" data-bp-group="file-choice-foot" data-bp-row="">
            <button
              type="button"
              className="bp-btn bp-btn--danger bp-focusable"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onCancel();
              }}
            >
              {t('bp.install.cancelDownload')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * In place of Install while the game downloads: how far along it is, and
 * a way to the queue.
 */
export function BpDownloadButton({ download, primary }: { download: ThreadDownload; primary?: boolean }) {
  const { t } = useT();
  const bp = useBp();
  const label =
    download.phase === 'extracting'
      ? t('status.extracting')
      : download.phase === 'queued'
        ? t('bp.badge.queued')
        : t('status.downloading');
  return (
    <button
      type="button"
      className={`bp-btn bp-btn--progress${primary ? ' bp-btn--lg' : ''} bp-focusable`}
      style={{ '--pct': `${download.percent ?? 0}%` } as React.CSSProperties}
      data-indeterminate={download.percent == null || undefined}
      data-bp-autofocus={primary || undefined}
      data-bp-a={t('bp.tab.downloads')}
      onClick={() => bp.switchTab('downloads')}
    >
      <Icon name="download" size={primary ? 22 : 20} />
      {label}
      {download.percent != null && <span className="bp-btn-pct">{download.percent}%</span>}
    </button>
  );
}
