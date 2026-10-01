import { useMemo } from 'react';
import { useDownloads } from '../../../contexts/Downloads';
import { useDownloadSettings } from '../../../contexts/DownloadSettings';
import { formatDownloadSpeed } from '../../../lib/downloadSettings';
import { canVerifyInApp, verifyNeedsContinue } from '../../../lib/downloadHosts';
import { formatIpcError } from '../../../lib/ipcError';
import * as downloads from '../../../lib/downloads';
import * as ipc from '../../../lib/ipc';
import * as library from '../../../lib/library';
import { useT } from '../../../lib/i18n';
import { formatBytes, formatEta, stateKey, type DownloadRow } from '../../../types/download';
import { LibraryCover } from '../../library/LibraryCover';
import { useBp, useBpGames } from '../BpContext';
import { BpEmpty, BpHeading } from '../BpParts';

const ACTIVE = new Set(['pending', 'resolving', 'awaiting_choice', 'downloading', 'needs_browser']);
const HISTORY_SIZE = 8;

/** What is downloading now, big enough to read from the couch, and the latest finished. */
export function BpDownloads() {
  const { t } = useT();
  const bp = useBp();
  const games = useBpGames();
  const { rows, progress, extractProgress, reload } = useDownloads();
  const { settings: dlSettings } = useDownloadSettings();

  const byThread = useMemo(() => new Map((games ?? []).map((g) => [g.threadId, g])), [games]);
  const active = rows.filter((r) => ACTIVE.has(r.state) || (r.destPath && extractProgress[r.destPath] != null));
  const history = rows
    .filter((r) => !active.includes(r))
    .slice(0, HISTORY_SIZE);

  async function cancel(row: DownloadRow) {
    await ipc.downloadCancel(row.id);
    await downloads.markCancelled(row.id, progress[row.id]?.bytes ?? row.bytesDone);
    try {
      await library.setStatus(row.threadId, 'not_installed');
    } catch {
      /* not in the library */
    }
    await reload();
  }

  /** The verification window stays on top, so it shows over Big Picture. */
  async function verify(row: DownloadRow) {
    try {
      await ipc.openCaptchaWindow({
        downloadId: row.id,
        url: row.resolvedUrl ?? row.sourceUrl,
        host: row.host,
        title: t('downloads.verify.windowTitle', { host: row.host }),
      });
    } catch (err) {
      console.warn('[bp] open verification failed', err);
    }
  }

  /** MixDrop: after the check, its session goes to the downloader. */
  async function continueVerified(row: DownloadRow) {
    try {
      await downloads.markRetry(row.id);
      await ipc.downloadContinueCaptcha({
        id: row.id,
        sourceUrl: row.sourceUrl,
        pageUrl: row.resolvedUrl ?? row.sourceUrl,
        threadId: row.threadId,
        libraryPath: row.libraryPath,
      });
    } catch (err) {
      await downloads.markError(row.id, formatIpcError(err));
    }
    await reload();
  }

  const totalSpeed = active.reduce((sum, r) => sum + (r.state === 'downloading' ? (progress[r.id]?.speedBps ?? 0) : 0), 0);

  return (
    <div className="bp-screen-body bp-page" data-bp-scroll-y="">
      <BpHeading title={t('bp.downloads.active')} count={active.length}>
        {totalSpeed > 0 && (
          <span className="bp-heading-aside">{formatDownloadSpeed(totalSpeed, dlSettings.speedInMbps)}</span>
        )}
      </BpHeading>
      {active.length === 0 ? (
        <BpEmpty icon="download" title={t('bp.downloads.empty')} />
      ) : (
        <div className="bp-dl-list" data-bp-group="dl-active">
          {active.map((row, i) => {
            const game = byThread.get(row.threadId);
            const live = progress[row.id];
            const extracting = row.destPath ? extractProgress[row.destPath] : undefined;
            const done = live?.bytes ?? row.bytesDone;
            const total = live?.total ?? row.bytesTotal;
            const pct =
              extracting != null
                ? Math.round(extracting)
                : total
                  ? Math.min(100, Math.floor((done / total) * 100))
                  : null;
            const speed = live?.speedBps ?? 0;
            const verifyHere = canVerifyInApp(row);
            const needsDesktop =
              row.state === 'awaiting_choice' || (row.state === 'needs_browser' && !verifyHere);
            return (
              <article key={row.id} className="bp-dl" style={{ '--i': i } as React.CSSProperties}>
                <span className="bp-dl-art">
                  <LibraryCover url={game?.thumbnailUrl ?? null} title={game?.title ?? row.threadId} />
                </span>
                <div className="bp-dl-body">
                  <div className="bp-dl-title">{game?.title ?? row.threadId}</div>
                  <div className="bp-dl-meta">
                    <span className="bp-pill">{extracting != null ? t('status.extracting') : t(stateKey(row.state))}</span>
                    <span>{row.host}</span>
                    {row.gameVersion && <span>{row.gameVersion}</span>}
                  </div>
                  <div className="bp-progress" data-indeterminate={pct == null || undefined}>
                    <span style={{ width: `${pct ?? 100}%` }} />
                  </div>
                  <div className="bp-dl-stats">
                    <span>{pct != null ? `${pct}%` : '—'}</span>
                    {extracting == null && (
                      <span>
                        {formatBytes(done)} / {formatBytes(total)}
                      </span>
                    )}
                    {row.state === 'downloading' && speed > 0 && (
                      <>
                        <span>{formatDownloadSpeed(speed, dlSettings.speedInMbps)}</span>
                        {total ? <span>{t('bp.downloads.eta', { eta: formatEta(total - done, speed) })}</span> : null}
                      </>
                    )}
                  </div>
                </div>
                <div className="bp-dl-actions" data-bp-row="" data-bp-group={`dl-${row.id}`}>
                  {verifyHere && (
                    <button type="button" className="bp-btn bp-focusable" onClick={() => void verify(row)}>
                      {t('bp.downloads.verify')}
                    </button>
                  )}
                  {verifyHere && verifyNeedsContinue(row.host) && (
                    <button type="button" className="bp-btn bp-focusable" onClick={() => void continueVerified(row)}>
                      {t('downloads.action.continueCaptcha')}
                    </button>
                  )}
                  {needsDesktop && (
                    <button type="button" className="bp-btn bp-focusable" onClick={() => bp.exit('/downloads')}>
                      {t('bp.downloads.desktop')}
                    </button>
                  )}
                  {extracting == null && (
                    <button
                      type="button"
                      className="bp-btn bp-btn--danger bp-focusable"
                      data-bp-autofocus={i === 0 || undefined}
                      onClick={() => void cancel(row)}
                    >
                      {t('bp.downloads.cancel')}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {history.length > 0 && (
        <>
          <BpHeading title={t('bp.downloads.history')} count={history.length} />
          <div className="bp-dl-history">
            {history.map((row) => {
              const game = byThread.get(row.threadId);
              return (
                <button
                  key={row.id}
                  type="button"
                  className="bp-dl-row bp-focusable"
                  data-bp-a={game ? t('bp.hint.open') : undefined}
                  onClick={() => {
                    if (game) bp.openGame(game);
                  }}
                >
                  <span className="bp-dl-row-art">
                    <LibraryCover url={game?.thumbnailUrl ?? null} title={game?.title ?? row.threadId} quality="preview" />
                  </span>
                  <span className="bp-dl-row-title">{game?.title ?? row.threadId}</span>
                  <span className={`bp-dl-row-state bp-dl-row-state--${row.state}`}>{t(stateKey(row.state))}</span>
                  <span className="bp-dl-row-size">{formatBytes(row.bytesTotal ?? row.bytesDone)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
