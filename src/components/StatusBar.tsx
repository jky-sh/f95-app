import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getVersion } from '@tauri-apps/api/app';
import { useDownloads } from '../contexts/Downloads';
import { useDownloadSettings } from '../contexts/DownloadSettings';
import * as library from '../lib/library';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { formatDownloadSpeed } from '../lib/downloadSettings';
import type { DownloadProgress, DownloadRow } from '../types/download';
import { formatBytes, stateKey } from '../types/download';
import { VersionInfoModal } from './VersionInfoModal';

const ACTIVE_STATES = new Set(['pending', 'resolving', 'downloading']);

function displayName(
  row: DownloadRow,
  titles: Record<string, string>,
): string {
  if (titles[row.threadId]) return titles[row.threadId];
  if (row.destPath) {
    const base = row.destPath.split(/[/\\]/).pop();
    if (base) return base;
  }
  return `#${row.threadId}`;
}

function progressPct(
  row: DownloadRow,
  progress: DownloadProgress | undefined,
): number | null {
  const liveBytes = progress?.bytes ?? row.bytesDone;
  const liveTotal = progress?.total ?? row.bytesTotal;
  if (!liveTotal || liveTotal <= 0) return null;
  return Math.min(100, (liveBytes / liveTotal) * 100);
}

/**
 * Steam-style bottom bar: live download progress on the left, app version on
 * the right. Clicking the download area opens the full Downloads page.
 */
export function StatusBar() {
  const { t } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { rows, progress } = useDownloads();
  const { settings: dlSettings } = useDownloadSettings();
  const [version, setVersion] = useState<string | null>(null);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const active = useMemo(
    () => rows.filter((r) => ACTIVE_STATES.has(r.state)),
    [rows],
  );

  const primary = active[0] ?? null;
  const extraCount = Math.max(0, active.length - 1);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('—'));
  }, []);

  useEffect(() => {
    function openFromTray() {
      setVersionModalOpen(true);
    }
    window.addEventListener('f95:open-version-modal', openFromTray);
    return () => window.removeEventListener('f95:open-version-modal', openFromTray);
  }, []);

  useEffect(() => {
    if (active.length === 0) {
      setTitles({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        active.map(async (row) => {
          try {
            const game = await library.get(row.threadId);
            if (game?.title) next[row.threadId] = game.title;
          } catch {
            /* ignore */
          }
        }),
      );
      if (!cancelled) setTitles(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const primaryProgress = primary ? progress[primary.id] : undefined;
  const pct = primary ? progressPct(primary, primaryProgress) : null;
  const liveBytes = primary
    ? (primaryProgress?.bytes ?? primary.bytesDone)
    : 0;
  const liveTotal = primary
    ? (primaryProgress?.total ?? primary.bytesTotal)
    : null;
  const speedBps = primaryProgress?.speedBps ?? 0;

  return (
    <footer style={barStyle} className="status-bar">
      <Link to="/downloads" style={downloadLinkStyle} className="status-bar-downloads">
        {primary ? (
          <>
            <span style={downloadIconWrap} aria-hidden>
              <DownloadIcon active={primary.state === 'downloading'} />
            </span>
            <span style={downloadTextWrap}>
              <span style={downloadLabelStyle}>
                {primary.state === 'downloading'
                  ? t('statusbar.downloading', {
                      name: displayName(primary, titles),
                      pct: pct !== null ? pct.toFixed(0) : '—',
                    })
                  : t('statusbar.resolving', {
                      name: displayName(primary, titles),
                      state: t(stateKey(primary.state)),
                    })}
                {extraCount > 0 &&
                  ` ${t('statusbar.more', { count: extraCount })}`}
              </span>
              {(primary.state === 'downloading' || pct !== null) && (
                <span style={downloadMetaStyle}>
                  {formatBytes(liveBytes)}
                  {liveTotal ? ` / ${formatBytes(liveTotal)}` : ''}
                  {speedBps > 0
                    ? ` · ${formatDownloadSpeed(speedBps, dlSettings.speedInMbps)}`
                    : ''}
                </span>
              )}
            </span>
            {pct !== null && (
              <span style={progressTrackStyle} aria-hidden>
                <span style={{ ...progressFillStyle, width: `${pct}%` }} />
              </span>
            )}
          </>
        ) : (
          <>
            <span style={downloadIconWrap} aria-hidden>
              <DownloadIcon active={false} />
            </span>
            <span style={idleTextStyle}>{t('statusbar.idle')}</span>
          </>
        )}
      </Link>

      {isOffline && (
        <button
          type="button"
          className="status-bar-offline-badge"
          title={t('offline.badge')}
          onClick={() => navigate('/settings#settings-offline')}
        >
          {t('offline.badge')}
        </button>
      )}

      <button
        type="button"
        className="status-bar-version"
        title={t('statusbar.versionTitle')}
        aria-label={t('statusbar.versionTitle')}
        onClick={() => setVersionModalOpen(true)}
      >
        {version ? `v${version}` : '…'}
      </button>

      <VersionInfoModal
        open={versionModalOpen}
        version={version}
        onClose={() => setVersionModalOpen(false)}
      />
    </footer>
  );
}

function DownloadIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 2v7.2M8 9.2 5.4 6.6M8 9.2l2.6-2.6M3 11.5v1.2c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3v-1.2"
        stroke={active ? 'var(--accent)' : 'var(--text-muted)'}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const barStyle: React.CSSProperties = {
  height: 28,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'space-between',
  background: 'var(--bg-sidebar)',
  borderTop: '1px solid var(--border-faint)',
  userSelect: 'none',
  position: 'relative',
  zIndex: 50,
};

const downloadLinkStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  textDecoration: 'none',
  color: 'inherit',
  position: 'relative',
  overflow: 'hidden',
};

const downloadIconWrap: React.CSSProperties = {
  display: 'inline-flex',
  flexShrink: 0,
};

const downloadTextWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  gap: 1,
};

const downloadLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-tertiary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  lineHeight: 1.2,
};

const downloadMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  lineHeight: 1.2,
};

const idleTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
};

const progressTrackStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 2,
  background: 'var(--bg-sunken)',
};

const progressFillStyle: React.CSSProperties = {
  display: 'block',
  height: '100%',
  background: 'var(--accent)',
  transition: 'width 200ms linear',
};
