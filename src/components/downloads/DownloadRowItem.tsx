import { Link } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { useDownloadSettings } from '../../contexts/DownloadSettings';
import { formatDownloadSpeed } from '../../lib/downloadSettings';
import { isArchivePath, cleanDownloadFileName } from '../../lib/archives';
import type { DownloadProgress, DownloadRow } from '../../types/download';
import {
  formatBytes,
  formatEta,
  stateKey,
} from '../../types/download';
import type { DownloadGameInfo } from './DownloadCard';
import { parseDbTime } from '../../lib/dbTime';
import { LibraryCover } from '../library/LibraryCover';
import { Icon } from '../ui/Icon';

interface Props {
  row: DownloadRow;
  progress: DownloadProgress | undefined;
  game?: DownloadGameInfo;
  onCancel: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/** Full-width card for in-progress downloads. */
export function DownloadActiveCard({ row, progress, game, onCancel, onContextMenu }: Props) {
  const { t } = useT();
  const { settings: dlSettings } = useDownloadSettings();
  const liveBytes = progress?.bytes ?? row.bytesDone;
  const liveTotal = progress?.total ?? row.bytesTotal;
  const pct =
    liveTotal && liveTotal > 0
      ? Math.min(100, (liveBytes / liveTotal) * 100)
      : null;
  const displayTitle = game?.title ?? t('dl.thread', { id: row.threadId });

  return (
    <article className="dl-active-card" onContextMenu={onContextMenu}>
      <Link to={`/store/game/${row.threadId}`} className="dl-active-thumb">
        <LibraryCover url={game?.thumbnailUrl ?? null} title={displayTitle} quality="preview" />
      </Link>

      <div className="dl-active-body">
        <div className="dl-active-top">
          <div>
            <Link to={`/store/game/${row.threadId}`} className="dl-active-title">
              {displayTitle}
            </Link>
            <div className="dl-active-sub">
              <span className={`dl-pill dl-pill-${row.state}`}>{t(stateKey(row.state))}</span>
              <span className="dl-meta-text">{row.host}</span>
              {row.gameVersion && <span className="dl-meta-text">{row.gameVersion}</span>}
            </div>
          </div>
          {pct !== null && <span className="dl-active-pct">{pct.toFixed(0)}%</span>}
        </div>

        <div className="dl-active-progress">
          <div className="dl-active-progress-fill" style={{ width: `${pct ?? 0}%` }} />
        </div>

        <div className="dl-active-footer">
          <span className="dl-meta-text">
            {formatBytes(liveBytes)}
            {liveTotal ? ` / ${formatBytes(liveTotal)}` : ''}
            {progress && progress.speedBps > 0 && (
              <> · {formatDownloadSpeed(progress.speedBps, dlSettings.speedInMbps)}</>
            )}
            {progress && progress.speedBps > 0 && liveTotal && (
              <> · {t('dllist.meta.eta', { eta: formatEta(liveTotal - liveBytes, progress.speedBps) })}</>
            )}
          </span>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>
            <Icon name="x" size={13} />
            {t('downloads.action.cancel')}
          </button>
        </div>
      </div>
    </article>
  );
}

interface RowProps {
  row: DownloadRow;
  game?: DownloadGameInfo;
  /** Percentual da extração em andamento deste arquivo (auto ou manual). */
  extractPct?: number;
  onRemove: () => void;
  onReveal: () => void;
  onRetry: () => void;
  onExtract: () => void;
  onOpenCaptcha?: () => void;
  onContinueCaptcha?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/** Compact single-line row for history (completed / failed / etc.). */
export function DownloadHistoryRow({
  row,
  game,
  extractPct,
  onRemove,
  onReveal,
  onRetry,
  onExtract,
  onOpenCaptcha,
  onContinueCaptcha,
  onContextMenu,
}: RowProps) {
  const { t } = useT();
  const [extracting, setExtracting] = useState(false);
  const busyExtracting = extracting || extractPct !== undefined;
  const [continuing, setContinuing] = useState(false);
  const isArchive = row.destPath ? isArchivePath(row.destPath) : false;
  const displayTitle = game?.title ?? t('dl.thread', { id: row.threadId });
  const fileName = fileLabel(row, displayTitle);
  const size = formatBytes(row.bytesTotal ?? row.bytesDone);
  const captchaHost = supportsCaptchaWindow(row.host);
  const finished = parseDbTime(row.finishedAt);
  const date = finished
    ? finished.toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <article
      className={`dl-history-row dl-history-row-${row.state}`}
      onContextMenu={onContextMenu}
    >
      <Link to={`/store/game/${row.threadId}`} className="dl-history-thumb">
        <LibraryCover url={game?.thumbnailUrl ?? null} title={displayTitle} quality="preview" />
      </Link>

      <div className="dl-history-main">
        <Link to={`/store/game/${row.threadId}`} className="dl-history-title">
          {displayTitle}
        </Link>
        <span className="dl-history-file" title={row.destPath ?? row.sourceUrl}>
          {fileName}
        </span>
      </div>

      <span
        className={`dl-history-col dl-pill dl-pill-${row.state}`}
        title={t(stateKey(row.state))}
      >
        {row.state === 'needs_browser'
          ? captchaHost
            ? t('downloads.action.captchaShort')
            : t('downloads.action.openBrowserShort')
          : t(stateKey(row.state))}
      </span>
      <span className="dl-history-col dl-history-host">{row.host}</span>
      <span className="dl-history-col">{row.gameVersion ?? '—'}</span>
      <span className="dl-history-col dl-history-size">{size}</span>
      <span className="dl-history-col dl-history-date">{date ?? '—'}</span>

      {row.errorMessage && row.state === 'failed' && (
        <div className="dl-history-error">{row.errorMessage}</div>
      )}

      <div className="dl-history-actions">
        {row.state === 'needs_browser' && captchaHost && row.resolvedUrl && (
          <>
            <button type="button" className="dl-action-btn" onClick={onOpenCaptcha}>
              {t('downloads.action.openCaptcha')}
            </button>
            <button
              type="button"
              className="dl-action-btn dl-action-btn-accent"
              disabled={continuing}
              onClick={async () => {
                if (!onContinueCaptcha) return;
                setContinuing(true);
                try {
                  await onContinueCaptcha();
                } finally {
                  setContinuing(false);
                }
              }}
            >
              {continuing
                ? t('downloads.action.continuingCaptcha')
                : t('downloads.action.continueCaptcha')}
            </button>
          </>
        )}
        {row.state === 'needs_browser' && !captchaHost && row.resolvedUrl && (
          <button type="button" className="dl-action-btn" onClick={() => openUrl(row.resolvedUrl!)}>
            {t('downloads.action.openBrowserShort')}
          </button>
        )}
        {row.state === 'completed' && row.destPath && (
          <>
            {isArchive && (
              <button
                type="button"
                className="dl-action-btn dl-action-btn-accent"
                disabled={busyExtracting}
                onClick={async () => {
                  setExtracting(true);
                  try {
                    await onExtract();
                  } finally {
                    setExtracting(false);
                  }
                }}
              >
                {busyExtracting
                  ? extractPct !== undefined
                    ? t('downloads.action.extractingPct', { pct: extractPct })
                    : t('downloads.action.extracting')
                  : t('downloads.action.extract')}
              </button>
            )}
            <button type="button" className="dl-action-btn" onClick={onReveal}>
              {t('downloads.action.revealShort')}
            </button>
            <Link to={`/library/game/${row.threadId}`} className="dl-action-btn">
              {t('downloads.action.libraryShort')}
            </Link>
          </>
        )}
        {(row.state === 'failed' || row.state === 'cancelled' || row.state === 'needs_browser') && (
          <button type="button" className="dl-action-btn dl-action-btn-accent" onClick={onRetry}>
            {t('downloads.action.retry')}
          </button>
        )}
        <button type="button" className="dl-action-btn dl-action-btn-muted" onClick={onRemove}>
          {t('common.remove')}
        </button>
      </div>
    </article>
  );
}

function supportsCaptchaWindow(host: string): boolean {
  return host.trim().toLowerCase() === 'mixdrop';
}

function looksLikeGarbageName(name: string): boolean {
  return (
    name.length >= 32 &&
    !name.includes('.') &&
    /^[a-zA-Z0-9_-]+$/.test(name)
  );
}

function fileLabel(row: DownloadRow, fallbackTitle?: string): string {
  if (row.destPath) {
    const base = row.destPath.split(/[/\\]/).pop() ?? row.destPath;
    const cleaned = cleanDownloadFileName(base);
    if (!looksLikeGarbageName(cleaned)) return cleaned;
  }
  const url = row.resolvedUrl ?? row.sourceUrl;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const filename =
      parts.length >= 3 && parts[0] === 'download' && parts[2]?.includes('.')
        ? parts[2]
        : parts.pop();
    if (filename && !looksLikeGarbageName(filename)) return filename;
  } catch {
    /* fall through */
  }
  if (fallbackTitle) return fallbackTitle;
  return row.state === 'needs_browser' ? 'Google Drive' : url;
}
