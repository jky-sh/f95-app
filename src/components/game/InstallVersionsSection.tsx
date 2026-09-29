import { useCallback, useEffect, useState } from 'react';
import * as installVersions from '../../lib/installVersions';
import { engineLabel } from '../../lib/installVersions';
import type { InstallVersion } from '../../lib/installVersions';
import * as ipc from '../../lib/ipc';
import { dialog } from '../../lib/dialog';
import { useRunningGames } from '../../contexts/RunningGames';
import { useT } from '../../lib/i18n';
import { formatBytes } from '../../types/download';
import { GameDetailSection } from './GameDetailLayout';
import type { LibraryGame } from '../../types/library';

interface Props {
  game: LibraryGame;
  /** Chamado após trocar a ativa / excluir — o pai recarrega a linha do jogo. */
  onChanged: () => void | Promise<void>;
}

function versionDisplayName(v: InstallVersion): string {
  if (v.version) return v.version;
  const base = v.installPath.split(/[/\\]/).pop();
  return base ?? v.installPath;
}

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/**
 * Versões instaladas lado a lado (página do jogo). Cada linha mostra rótulo,
 * engine detectada, tamanho e data; a ativa é a que o botão Jogar do herói
 * usa. Ações: jogar aquela versão, torná-la ativa (rollback de update
 * quebrado), abrir a pasta e excluir para liberar disco.
 */
export function InstallVersionsSection({ game, onChanged }: Props) {
  const { t } = useT();
  const { running, launch } = useRunningGames();
  const [versions, setVersions] = useState<InstallVersion[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const isRunning = running.has(game.threadId);

  const load = useCallback(async () => {
    try {
      const list = await installVersions.listForGame(game);
      setVersions(list);
    } catch (err) {
      console.warn('[versions] list failed', err);
      setVersions([]);
    }
  }, [game]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!versions || versions.length === 0) return null;

  async function onPlayVersion(v: InstallVersion) {
    if (!v.exePath || isRunning) return;
    try {
      await launch(game, v.exePath);
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
    }
  }

  async function onActivate(v: InstallVersion) {
    setBusyId(v.id);
    try {
      await installVersions.setActive(game, v);
      await onChanged();
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(v: InstallVersion) {
    const size = v.sizeBytes != null ? formatBytes(v.sizeBytes) : '?';
    const ok = await dialog.confirm(
      t('libdetail.versions.confirmDelete', {
        label: versionDisplayName(v),
        size,
      }),
      { title: t('libdetail.versions.title'), kind: 'warning' },
    );
    if (!ok) return;
    setBusyId(v.id);
    try {
      const result = await installVersions.deleteVersion(v);
      if (!result.deleted && result.skippedPath) {
        await dialog.alert(
          t('libdetail.uninstall.partial', { paths: result.skippedPath }),
        );
      }
      await load();
      await onChanged();
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <GameDetailSection title={t('libdetail.versions.title')}>
      <ul className="game-detail-version-list">
        {versions.map((v) => (
          <li
            key={v.id}
            className={`game-detail-version-row${v.active ? ' game-detail-version-row-active' : ''}`}
          >
            <div className="game-detail-version-main">
              <span className="game-detail-version-name" title={v.installPath}>
                {versionDisplayName(v)}
              </span>
              <span className="game-detail-version-meta">
                {v.active && (
                  <span className="game-detail-version-badge">
                    {t('libdetail.versions.active')}
                  </span>
                )}
                {v.engine && <span>{engineLabel(v.engine)}</span>}
                {v.sizeBytes != null && v.sizeBytes > 0 && (
                  <span>{formatBytes(v.sizeBytes)}</span>
                )}
                <span>{new Date(v.installedAt).toLocaleDateString()}</span>
              </span>
            </div>
            <div className="game-detail-version-actions">
              {!v.active && (
                <button
                  type="button"
                  className="dl-action-btn"
                  disabled={busyId === v.id}
                  title={t('libdetail.versions.makeActive.title')}
                  onClick={() => onActivate(v)}
                >
                  {t('libdetail.versions.makeActive')}
                </button>
              )}
              {v.exePath && game.category === 'games' && (
                <button
                  type="button"
                  className="dl-action-btn"
                  disabled={isRunning || busyId === v.id}
                  title={
                    isRunning
                      ? t('libdetail.versions.play.blockedRunning')
                      : t('libdetail.versions.play.title')
                  }
                  onClick={() => onPlayVersion(v)}
                >
                  {t('libdetail.action.play')}
                </button>
              )}
              <button
                type="button"
                className="dl-action-btn"
                onClick={() => void ipc.revealInExplorer(v.installPath)}
              >
                {t('common.open')}
              </button>
              <button
                type="button"
                className="dl-action-btn dl-action-btn-muted"
                disabled={v.active || isRunning || busyId === v.id}
                title={
                  v.active
                    ? t('libdetail.versions.delete.blockedActive')
                    : t('libdetail.versions.delete.title')
                }
                onClick={() => onDelete(v)}
              >
                {t('common.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="game-detail-versions-hint">{t('libdetail.versions.hint')}</p>
    </GameDetailSection>
  );
}
