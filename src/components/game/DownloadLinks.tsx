import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { GameDownload, SocialLink } from '../../types/game';
import * as libraries from '../../lib/libraries';
import { HOST_COLORS, groupDownloads, hostDelivery, shouldShowHostBadge } from '../../lib/downloadHosts';
import { startGameDownload } from '../../lib/startGameDownload';
import { useOffline } from '../../contexts/Offline';
import { useT } from '../../lib/i18n';
import { dialog } from '../../lib/dialog';
import { InstallLocationModal } from '../InstallLocationModal';
import type { InstallLibraryWithDisk } from '../../types/install-library';
import type { SamCategory } from '../../types/sam';

export interface DownloadLinksGameInfo {
  threadId: string;
  category?: SamCategory;
  title: string;
  threadUrl: string;
  thumbnailUrl: string | null;
  version: string | null;
}

interface Props {
  game: DownloadLinksGameInfo;
  downloads: GameDownload[];
  social: SocialLink[];
  embedded?: boolean;
  /** Chamado quando um download foi de fato iniciado (modal usa pra fechar). */
  onDownloadStarted?: () => void;
}

export function DownloadLinks({ game, downloads: items, social, embedded, onDownloadStarted }: Props) {
  const { t } = useT();
  const { isOffline } = useOffline();
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<GameDownload | null>(null);

  const groups = groupDownloads(items);

  async function startDownload(download: GameDownload, libraryPath?: string) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    setBusyUrl(download.url);
    try {
      await startGameDownload(game, download, libraryPath);
      onDownloadStarted?.();
    } catch (err) {
      await dialog.alert(t('dl.start.failed', { error: formatError(err) }), { kind: 'error' });
    } finally {
      setBusyUrl(null);
    }
  }

  async function onDownloadClick(download: GameDownload) {
    await libraries.ensureSeeded();
    const libs = await libraries.listWithDisk();
    if (libs.length <= 1) {
      await startDownload(download, libs[0]?.path);
      return;
    }
    setPending(download);
    setPickerOpen(true);
  }

  async function onLibraryPicked(lib: InstallLibraryWithDisk) {
    setPickerOpen(false);
    if (!pending) return;
    const dl = pending;
    setPending(null);
    await startDownload(dl, lib.path);
  }

  if (items.length === 0 && social.length === 0) {
    return <p className="dl-meta-text">{t('dl.empty')}</p>;
  }

  return (
    <>
      {!embedded && <h3>{t('dl.section')}</h3>}

      {groups.map(([label, groupItems]) => (
        <div key={label ?? 'default'} style={{ marginBottom: 12 }}>
          {label && (
            <div className="dl-meta-text" style={{ marginBottom: 6, fontWeight: 600 }}>
              {label}
            </div>
          )}
          <ul className="dl-item-list">
            {groupItems.map((download) => {
              const delivery = hostDelivery(download.host);
              const color = HOST_COLORS[download.host] ?? 'var(--text-muted)';
              const labelText = download.text?.trim() || download.host;
              const showHost = shouldShowHostBadge(labelText, download.host);
              // Hosts with a quick check say so next to the host name.
              const badge = [
                showHost ? download.host : null,
                delivery === 'verify' ? t('dl.btn.quickCheck') : null,
              ]
                .filter(Boolean)
                .join(' · ');
              const rowKey = `${download.group ?? ''}\0${download.url}`;
              return (
                <li
                  key={rowKey}
                  className={`dl-item-row${badge ? ' dl-item-row--with-host' : ''}`}
                >
                  <span
                    className="dl-item-dot"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <span className="dl-item-label" title={labelText}>
                    {labelText}
                  </span>
                  {badge && <span className="dl-item-host">{badge}</span>}
                  <button
                    type="button"
                    className="dl-action-btn dl-action-btn-accent dl-item-action"
                    disabled={busyUrl === download.url}
                    title={
                      delivery === 'app'
                        ? t('dl.btn.tooltipSupported', { host: download.host })
                        : delivery === 'verify'
                          ? t('dl.btn.tooltipVerify', { host: download.host })
                          : t('dl.btn.tooltipUnsupported', { host: download.host })
                    }
                    onClick={() => onDownloadClick(download)}
                  >
                    {busyUrl === download.url
                      ? '…'
                      : delivery === 'browser'
                        ? t('dl.btn.queue')
                        : t('dl.btn.download')}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {social.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="dl-meta-text" style={{ marginBottom: 8, fontWeight: 600 }}>
            {t('dl.support')}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {social.map((link) => (
              <li key={link.url}>
                <button
                  type="button"
                  className="dl-link-btn"
                  onClick={() => openUrl(link.url)}
                >
                  {link.text?.trim() || link.host}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <InstallLocationModal
        open={pickerOpen}
        title={t('modal.install.title', { game: game.title })}
        description={t('modal.install.hint')}
        primaryLabel={t('modal.install.confirm')}
        onCancel={() => {
          setPickerOpen(false);
          setPending(null);
        }}
        onConfirm={onLibraryPicked}
      />
    </>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
