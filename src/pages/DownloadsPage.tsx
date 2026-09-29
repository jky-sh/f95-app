import { Link, useNavigate } from 'react-router-dom';
import { dialog } from '../lib/dialog';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { runExtraction } from '../hooks/useDownloads';
import { useDownloads } from '../contexts/Downloads';
import { useDownloadSettings } from '../contexts/DownloadSettings';
import { formatDownloadSpeed } from '../lib/downloadSettings';
import type { DownloadGameInfo } from '../components/downloads/DownloadCard';
import { DownloadActiveCard, DownloadHistoryRow } from '../components/downloads/DownloadRowItem';
import * as downloads from '../lib/downloads';
import * as library from '../lib/library';
import * as ipc from '../lib/ipc';
import { OfflineGate } from '../components/OfflineGate';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { buildDownloadMenu } from '../lib/contextMenus/buildDownloadMenu';
import type { DownloadMenuCallbacks } from '../lib/contextMenus/buildDownloadMenu';
import { useT } from '../lib/i18n';
import type { DownloadRow } from '../types/download';
import { formatBytes } from '../types/download';

export function DownloadsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { openContextMenu } = useContextMenu();
  const { rows, progress, extractProgress, reload } = useDownloads();
  const { settings: dlSettings } = useDownloadSettings();
  const [libraryMap, setLibraryMap] = useState<Record<string, DownloadGameInfo>>({});
  const [clearing, setClearing] = useState(false);

  const loadLibraryMeta = useCallback(async () => {
    try {
      const games = await library.list();
      const next: Record<string, DownloadGameInfo> = {};
      for (const g of games) {
        next[g.threadId] = { title: g.title, thumbnailUrl: g.thumbnailUrl };
      }
      setLibraryMap(next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadLibraryMeta();
  }, [loadLibraryMeta, rows.length]);

  const active = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.state === 'downloading' ||
          r.state === 'resolving' ||
          r.state === 'awaiting_choice' ||
          r.state === 'pending',
      ),
    [rows],
  );
  const completed = useMemo(() => rows.filter((r) => r.state === 'completed'), [rows]);
  const other = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.state === 'failed' ||
          r.state === 'cancelled' ||
          r.state === 'needs_browser',
      ),
    [rows],
  );
  const history = useMemo(() => [...completed, ...other], [completed, other]);

  const totalSpeed = useMemo(() => {
    let bps = 0;
    for (const r of active) {
      if (r.state === 'downloading') {
        bps += progress[r.id]?.speedBps ?? 0;
      }
    }
    return bps;
  }, [active, progress]);

  const totalDownloaded = useMemo(() => {
    let bytes = 0;
    for (const r of rows) {
      if (r.state === 'completed' || r.state === 'downloading') {
        bytes += progress[r.id]?.bytes ?? r.bytesDone ?? 0;
      }
    }
    return bytes;
  }, [rows, progress]);

  const canClearHistory = history.length > 0;

  async function onCancel(row: DownloadRow) {
    await ipc.downloadCancel(row.id);
    const liveBytes = progress[row.id]?.bytes ?? row.bytesDone;
    await downloads.markCancelled(row.id, liveBytes);
    try {
      await library.setStatus(row.threadId, 'not_installed');
    } catch {
      /* not in library */
    }
    await reload();
  }

  async function onContinueCaptcha(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    const pageUrl = row.resolvedUrl ?? row.sourceUrl;
    try {
      await downloads.markRetry(row.id);
      await ipc.downloadContinueCaptcha({
        id: row.id,
        sourceUrl: row.sourceUrl,
        pageUrl,
        threadId: row.threadId,
      });
      await reload();
    } catch (err) {
      await dialog.alert(t('downloads.captcha.failed', { error: formatError(err) }), {
        kind: 'error',
      });
    }
  }

  async function onOpenCaptcha(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    const pageUrl = row.resolvedUrl ?? row.sourceUrl;
    await ipc.openCaptchaWindow({
      downloadId: row.id,
      url: pageUrl,
      host: row.host,
    });
  }

  async function onRetry(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    await downloads.markRetry(row.id);
    await ipc.downloadStart({
      id: row.id,
      sourceUrl: row.sourceUrl,
      threadId: row.threadId,
    });
    await reload();
  }

  async function onRemove(row: DownloadRow) {
    await downloads.remove(row.id);
    await reload();
  }

  async function onReveal(row: DownloadRow) {
    if (!row.destPath) return;
    try {
      await ipc.revealInExplorer(row.destPath);
    } catch (err) {
      console.warn('[reveal] failed', err);
      await dialog.alert(t('dllist.reveal.failed', { error: formatError(err) }), { kind: 'error' });
    }
  }

  async function onExtract(row: DownloadRow) {
    if (!row.destPath) return;
    try {
      await runExtraction(row.threadId, row.destPath, row.gameVersion);
      await reload();
    } catch (err) {
      await dialog.alert(t('dllist.extract.failed', { error: formatError(err) }), { kind: 'error' });
    }
  }

  function openDownloadContextMenu(
    e: React.MouseEvent,
    row: DownloadRow,
    callbacks: DownloadMenuCallbacks,
  ) {
    openContextMenu(
      e,
      buildDownloadMenu(row, { navigate, isOffline, t, callbacks }),
    );
  }

  async function onClearHistory() {
    const ok = await dialog.confirm(t('settings.maintenance.confirmFinished'), {
      title: t('downloads.action.clearHistory'),
      kind: 'warning',
    });
    if (!ok) return;
    setClearing(true);
    try {
      await downloads.clearFinished();
      await reload();
    } finally {
      setClearing(false);
    }
  }

  return (
    <OfflineGate allowReadOnly>
    <div className="downloads-page">
      <header className="downloads-top">
        <div className="downloads-top-text">
          <h1 className="downloads-title">{t('downloads.title')}</h1>
          <p className="downloads-subtitle">
            {rows.length > 0 ? t('downloads.subtitle') : t('downloads.subtitleEmpty')}
          </p>
        </div>
        <div className="downloads-top-actions">
          {canClearHistory && (
            <button
              type="button"
              className="downloads-toolbar-btn"
              onClick={onClearHistory}
              disabled={clearing}
            >
              {clearing ? t('downloads.action.clearing') : t('downloads.action.clearHistory')}
            </button>
          )}
          <button type="button" className="downloads-toolbar-btn" onClick={() => reload()}>
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {rows.length > 0 && (
        <div className="downloads-summary">
          <SummaryItem
            label={t('downloads.stats.active')}
            value={String(active.length)}
            active={active.length > 0}
          />
          <SummaryItem label={t('downloads.stats.completed')} value={String(completed.length)} />
          <SummaryItem label={t('downloads.stats.other')} value={String(other.length)} />
          <SummaryItem
            label={t('downloads.stats.totalSize')}
            value={totalDownloaded > 0 ? formatBytes(totalDownloaded) : '—'}
          />
          <SummaryItem
            label={t('downloads.stats.speed')}
            value={
              totalSpeed > 0
                ? formatDownloadSpeed(totalSpeed, dlSettings.speedInMbps)
                : '—'
            }
            active={totalSpeed > 0}
          />
        </div>
      )}

      {rows.length === 0 && (
        <div className="downloads-empty">
          <div className="downloads-empty-icon" aria-hidden>
            ↓
          </div>
          <p className="downloads-empty-title">{t('downloads.empty.title')}</p>
          <p className="downloads-empty-hint">{t('downloads.empty.hint')}</p>
          <Link to="/store" className="dl-action-btn dl-action-btn-accent downloads-empty-cta">
            {t('downloads.empty.cta')} →
          </Link>
        </div>
      )}

      {active.length > 0 && (
        <section className="downloads-block">
          <h2 className="downloads-block-title">{t('downloads.section.active')}</h2>
          <div className="downloads-active-list">
            {active.map((r) => (
              <DownloadActiveCard
                key={r.id}
                row={r}
                progress={progress[r.id]}
                game={libraryMap[r.threadId]}
                onCancel={() => onCancel(r)}
                onContextMenu={(e) =>
                  openDownloadContextMenu(e, r, { onCancel: () => onCancel(r) })
                }
              />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="downloads-block">
          <div className="downloads-history-panel">
            <div className="dl-history-panel-head">
              <h2 className="downloads-block-title">
                {t('downloads.section.history')}
                <span className="downloads-block-count">{history.length}</span>
              </h2>
              <p className="dl-history-panel-meta">
                {t('downloads.panel.meta', {
                  completed: completed.length,
                  size: totalDownloaded > 0 ? formatBytes(totalDownloaded) : '—',
                })}
              </p>
            </div>
            <div className="dl-history-table">
              <div className="dl-history-header">
                <span aria-hidden />
                <span>{t('downloads.col.game')}</span>
                <span>{t('downloads.col.status')}</span>
                <span>{t('downloads.col.host')}</span>
                <span>{t('downloads.col.version')}</span>
                <span>{t('downloads.col.size')}</span>
                <span>{t('downloads.col.date')}</span>
                <span className="dl-history-head-actions">{t('downloads.col.actions')}</span>
              </div>
              {history.map((r) => (
                <DownloadHistoryRow
                  key={r.id}
                  row={r}
                  game={libraryMap[r.threadId]}
                  extractPct={r.destPath != null ? extractProgress[r.destPath] : undefined}
                  onRemove={() => onRemove(r)}
                  onReveal={() => onReveal(r)}
                  onRetry={() => onRetry(r)}
                  onExtract={() => onExtract(r)}
                  onContinueCaptcha={() => onContinueCaptcha(r)}
                  onOpenCaptcha={() => onOpenCaptcha(r)}
                  onContextMenu={(e) =>
                    openDownloadContextMenu(e, r, {
                      onRemove: () => onRemove(r),
                      onReveal: () => onReveal(r),
                      onRetry: () => onRetry(r),
                      onExtract: () => onExtract(r),
                      onContinueCaptcha: () => onContinueCaptcha(r),
                      onOpenCaptcha: () => onOpenCaptcha(r),
                    })
                  }
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
    </OfflineGate>
  );
}

function SummaryItem({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className={`downloads-summary-item${active ? ' downloads-summary-item-active' : ''}`}>
      <span className="downloads-summary-value">{value}</span>
      <span className="downloads-summary-label">{label}</span>
    </div>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
