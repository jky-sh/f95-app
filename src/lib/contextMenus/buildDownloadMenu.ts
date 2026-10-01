import { openUrl } from '@tauri-apps/plugin-opener';
import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { NavigateFunction } from 'react-router-dom';
import { isArchivePath } from '../archives';
import { canVerifyInApp, verifyNeedsContinue } from '../downloadHosts';
import type { DownloadRow } from '../../types/download';
import type { TranslateFn } from '../libraryGameActions';
import { item, offlineTitle, sep } from './helpers';

export interface DownloadMenuCallbacks {
  onCancel?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onReveal?: () => void | Promise<void>;
  onExtract?: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onOpenCaptcha?: () => void | Promise<void>;
  onContinueCaptcha?: () => void | Promise<void>;
}

export interface DownloadMenuDeps {
  navigate: NavigateFunction;
  isOffline: boolean;
  t: TranslateFn;
  callbacks: DownloadMenuCallbacks;
}

export function buildDownloadMenu(
  row: DownloadRow,
  deps: DownloadMenuDeps,
): ContextMenuItem[] {
  const { navigate, isOffline, t, callbacks } = deps;
  const off = offlineTitle(isOffline, t);
  const verifyInApp = canVerifyInApp(row);
  const isArchive = row.destPath ? isArchivePath(row.destPath) : false;
  const pageUrl = row.resolvedUrl ?? row.sourceUrl;

  const items: ContextMenuItem[] = [
    item('detail', t('contextMenu.openStoreDetail'), () => {
      navigate(`/store/game/${row.threadId}`);
    }),
  ];

  if (
    row.state === 'pending' ||
    row.state === 'resolving' ||
    row.state === 'awaiting_choice' ||
    row.state === 'downloading'
  ) {
    if (callbacks.onCancel) {
      items.push(
        item('cancel', t('contextMenu.cancelDownload'), callbacks.onCancel, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
  }

  if (row.state === 'failed' && callbacks.onRetry) {
    items.push(
      item('retry', t('contextMenu.retryDownload'), callbacks.onRetry, {
        disabled: isOffline,
        title: off,
        danger: false,
      }),
    );
  }

  if (row.state === 'needs_browser' && row.resolvedUrl) {
    if (verifyInApp && callbacks.onOpenCaptcha) {
      items.push(
        item('captcha', t('downloads.action.openCaptcha'), callbacks.onOpenCaptcha, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
    if (verifyInApp && verifyNeedsContinue(row.host) && callbacks.onContinueCaptcha) {
      items.push(
        item('continueCaptcha', t('downloads.action.continueCaptcha'), callbacks.onContinueCaptcha, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
    // Also for verification hosts: the browser is the fallback when the
    // window can't get past the check.
    items.push(
      item('browser', t('downloads.action.openBrowserShort'), () => openUrl(pageUrl), {
        disabled: isOffline,
        title: off,
      }),
    );
  }

  if (row.state === 'completed' && row.destPath) {
    if (isArchive && callbacks.onExtract) {
      items.push(
        item('extract', t('contextMenu.extractArchive'), callbacks.onExtract, {
          disabled: isOffline,
          title: off,
        }),
      );
    }
    if (callbacks.onReveal) {
      items.push(item('reveal', t('contextMenu.revealInExplorer'), callbacks.onReveal));
    }
  }

  if (row.state === 'completed' || row.state === 'failed' || row.state === 'cancelled') {
    if (callbacks.onRemove) {
      items.push(
        sep('sep'),
        item('remove', t('contextMenu.removeDownload'), callbacks.onRemove, { danger: true }),
      );
    }
  }

  return items;
}
