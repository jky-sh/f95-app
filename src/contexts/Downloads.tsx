import { createContext, useContext, useState, type ReactNode } from 'react';
import { useDownloads as useDownloadsHook } from '../hooks/useDownloads';
import {
  HostFileChoiceModal,
  type HostFileChoiceOption,
} from '../components/HostFileChoiceModal';
import * as downloads from '../lib/downloads';
import * as ipc from '../lib/ipc';
import { dialog } from '../lib/dialog';
import { useT } from '../lib/i18n';
import type { DownloadProgress, DownloadRow } from '../types/download';

interface DownloadsValue {
  rows: DownloadRow[];
  progress: Record<number, DownloadProgress>;
  extractProgress: Record<string, number>;
  reload: () => Promise<void>;
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
  const value = useDownloadsHook({ onNeedsFileChoice: setFileChoice });
  const [choiceBusy, setChoiceBusy] = useState(false);

  async function onConfirmFileChoice(choiceId: string) {
    if (!fileChoice || choiceBusy) return;
    setChoiceBusy(true);
    try {
      await ipc.downloadContinueChoice({
        id: fileChoice.downloadId,
        choiceId,
        threadId: fileChoice.threadId,
        libraryPath: fileChoice.libraryPath,
      });
      setFileChoice(null);
      await value.reload();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : String(err);
      await dialog.alert(t('modal.hostFile.failed', { error: msg }), { kind: 'error' });
    } finally {
      setChoiceBusy(false);
    }
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <HostFileChoiceModal
        open={fileChoice != null}
        host={fileChoice?.host ?? ''}
        platformGroup={fileChoice?.platformGroup ?? null}
        recommendedFileId={fileChoice?.recommendedFileId}
        files={fileChoice?.files ?? []}
        onCancel={async () => {
          if (fileChoice) {
            await ipc.downloadCancel(fileChoice.downloadId);
            await downloads.markCancelled(fileChoice.downloadId);
            await value.reload();
          }
          setFileChoice(null);
        }}
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
