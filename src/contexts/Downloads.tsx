import { createContext, useContext, useState, type ReactNode } from 'react';
import { useDownloads as useDownloadsHook } from '../hooks/useDownloads';
import {
  HostFileChoiceModal,
  type HostFileChoiceOption,
} from '../components/HostFileChoiceModal';
import * as downloads from '../lib/downloads';
import * as ipc from '../lib/ipc';
import { useBigPictureState } from '../lib/bigPicture';
import { dialog } from '../lib/dialog';
import { useT } from '../lib/i18n';
import type { DownloadProgress, DownloadRow } from '../types/download';

interface DownloadsValue {
  rows: DownloadRow[];
  progress: Record<number, DownloadProgress>;
  extractProgress: Record<string, number>;
  reload: () => Promise<void>;
  /** A download waiting for the user to pick one of the files behind its link. */
  fileChoice: FileChoiceRequest | null;
  /** True while the picked file is being handed to the downloader. */
  fileChoiceBusy: boolean;
  confirmFileChoice: (choiceId: string) => Promise<void>;
  /** Cancels the waiting download. */
  cancelFileChoice: () => Promise<void>;
}

const Ctx = createContext<DownloadsValue | null>(null);

/**
 * Single subscription to `download:*` events for the whole app. Mount once
 * at AppShell so the status bar and Downloads page share live progress.
 */
interface FileChoiceRequest {
  downloadId: number;
  threadId: string;
  libraryPath?: string | null;
  host: string;
  platformGroup: string | null;
  recommendedFileId?: string | null;
  files: HostFileChoiceOption[];
}

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [fileChoice, setFileChoice] = useState<FileChoiceRequest | null>(null);
  const downloadsState = useDownloadsHook({ onNeedsFileChoice: setFileChoice });
  const [choiceBusy, setChoiceBusy] = useState(false);
  // Big Picture shows its own chooser.
  const bigPicture = useBigPictureState().status !== 'closed';

  async function onConfirmFileChoice(choiceId: string) {
    if (!fileChoice || choiceBusy) return;
    setChoiceBusy(true);
    try {
      // Off "Choose file" right away: the pick may wait a long time for a
      // one-at-a-time host (BowFile) to free its slot.
      await downloads.markRetry(fileChoice.downloadId);
      await ipc.downloadContinueChoice({
        id: fileChoice.downloadId,
        choiceId,
        threadId: fileChoice.threadId,
        libraryPath: fileChoice.libraryPath,
      });
      setFileChoice(null);
      await downloadsState.reload();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : String(err);
      // Not left queued with nothing running: Retry starts it over.
      await downloads.markError(fileChoice.downloadId, msg);
      await downloadsState.reload();
      await dialog.alert(t('modal.hostFile.failed', { error: msg }), { kind: 'error' });
    } finally {
      setChoiceBusy(false);
    }
  }

  async function onCancelFileChoice() {
    if (fileChoice) {
      await ipc.downloadCancel(fileChoice.downloadId);
      await downloads.markCancelled(fileChoice.downloadId);
      await downloadsState.reload();
    }
    setFileChoice(null);
  }

  const value: DownloadsValue = {
    ...downloadsState,
    fileChoice,
    fileChoiceBusy: choiceBusy,
    confirmFileChoice: onConfirmFileChoice,
    cancelFileChoice: onCancelFileChoice,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <HostFileChoiceModal
        open={fileChoice != null && !bigPicture}
        host={fileChoice?.host ?? ''}
        platformGroup={fileChoice?.platformGroup ?? null}
        recommendedFileId={fileChoice?.recommendedFileId}
        files={fileChoice?.files ?? []}
        onCancel={onCancelFileChoice}
        onConfirm={onConfirmFileChoice}
      />
    </Ctx.Provider>
  );
}

export type { FileChoiceRequest };

export function useDownloads(): DownloadsValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useDownloads must be used within DownloadsProvider');
  }
  return ctx;
}
