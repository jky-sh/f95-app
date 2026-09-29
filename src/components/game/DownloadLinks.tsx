import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { GameDownload, SocialLink } from '../../types/game';
import * as downloads from '../../lib/downloads';
import * as library from '../../lib/library';
import * as libraries from '../../lib/libraries';
import * as ipc from '../../lib/ipc';
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

const STREAMABLE_HOSTS = new Set(['pixeldrain', 'mediafire', 'gofile', 'mega', 'uploadhaven', 'buzzheavier', 'datanodes', 'gdrive', 'workupload', 'mixdrop']);

const HOST_COLORS: Record<string, string> = {
  mega: '#d9272e',
  mediafire: 'var(--status-info)',
  mixdrop: '#e85c00',
  pixeldrain: '#3a3a8f',
  gofile: '#4d4d4d',
  workupload: '#1f7a3a',
  uploadhaven: '#888888',
  datanodes: '#2a8aa8',
  buzzheavier: '#a87a2a',
  gdrive: '#4285f4',
  bunkr: '#8a3a3a',
  cyberfile: '#6f4d8a',
  cyberdrop: '#8a4d6f',
  rapidgator: '#cc8a3a',
  '1fichier': '#3aaa8a',
};

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
      await library.add({
        threadId: game.threadId,
        category: game.category,
        title: game.title,
        threadUrl: game.threadUrl,
        thumbnailUrl: game.thumbnailUrl,
        currentVersion: game.version,
      });
      const row = await downloads.create({
        threadId: game.threadId,
        host: download.host,
        sourceUrl: download.url,
        gameVersion: game.version,
      });
      await ipc.downloadStart({
        id: row.id,
        sourceUrl: row.sourceUrl,
        threadId: row.threadId,
        libraryPath,
        platformGroup: download.group,
      });
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
              const streamable = STREAMABLE_HOSTS.has(download.host);
              const color = HOST_COLORS[download.host] ?? 'var(--text-muted)';
              const labelText = download.text?.trim() || download.host;
              const showHost = shouldShowHostBadge(labelText, download.host);
              const rowKey = `${download.group ?? ''}\0${download.url}`;
              return (
                <li
                  key={rowKey}
                  className={`dl-item-row${showHost ? ' dl-item-row--with-host' : ''}`}
                >
                  <span
                    className="dl-item-dot"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <span className="dl-item-label" title={labelText}>
                    {labelText}
                  </span>
                  {showHost && (
                    <span className="dl-item-host">{download.host}</span>
                  )}
                  <button
                    type="button"
                    className="dl-action-btn dl-action-btn-accent dl-item-action"
                    disabled={busyUrl === download.url}
                    title={
                      streamable
                        ? t('dl.btn.tooltipSupported', { host: download.host })
                        : t('dl.btn.tooltipUnsupported', { host: download.host })
                    }
                    onClick={() => onDownloadClick(download)}
                  >
                    {busyUrl === download.url
                      ? '…'
                      : streamable
                        ? t('dl.btn.download')
                        : t('dl.btn.queue')}
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

function shouldShowHostBadge(label: string, host: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s._-]+/g, '');
  const nl = norm(label);
  const nh = norm(host);
  if (!nh) return false;
  if (nl === nh) return false;
  if (nl.includes(nh) || nh.includes(nl)) return false;
  return true;
}

function groupDownloads(items: GameDownload[]): [string | null, GameDownload[]][] {
  const map = new Map<string | null, GameDownload[]>();
  const order: (string | null)[] = [];
  for (const item of items) {
    const key = item.group?.trim() || null;
    if (!map.has(key)) {
      order.push(key);
      map.set(key, []);
    }
    map.get(key)!.push(item);
  }
  return order.map((key) => [key, map.get(key)!]);
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
