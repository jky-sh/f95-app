import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { dialog } from '../lib/dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import * as updates from '../lib/updates';
import * as uninstall from '../lib/uninstall';
import { useRunningGames } from '../contexts/RunningGames';
import { useOffline } from '../contexts/Offline';
import { InstallLocationModal } from '../components/InstallLocationModal';
import { MoveProgressModal } from '../components/MoveProgressModal';
import { GameAchievementsSection } from '../components/game/GameAchievementsSection';
import { InstallVersionsSection } from '../components/game/InstallVersionsSection';
import { GameDescription } from '../components/game/GameDescription';
import {
  CollapsibleHtml,
  StoreInfoFields,
  StoreTagList,
  sanitizeF95Html,
  useF95ContentLinks,
} from '../components/game/StoreDetailSections';
import { ScreenshotGallery } from '../components/game/ScreenshotGallery';
import { clearGridPreviewCache } from '../lib/gridPreviewQueue';
import { clearRemoteImageQueue } from '../lib/remoteImageQueue';
import {
  GameDetailActionItem,
  GameDetailActionList,
  GameDetailBackBar,
  GameDetailBody,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  GameDetailBtnDanger,
  GameDetailChip,
  GameDetailError,
  GameDetailField,
  GameDetailFields,
  GameDetailHero,
  GameDetailLoading,
  GameDetailMain,
  GameDetailShell,
  GameDetailSection,
  GameDetailStat,
  GameDetailStatGrid,
  GameDetailAside,
} from '../components/game/GameDetailLayout';
import { useLibraryGameActions } from '../hooks/useLibraryGameActions';
import { useLibraryGame } from '../hooks/useLibraryGame';
import { useStoreDetail } from '../hooks/useStoreDetail';
import { useStoreLinks } from '../hooks/useStoreLinks';
import { describeIpcError, formatIpcError } from '../lib/ipcError';
import { useSectionHref } from '../lib/lastSearch';
import { openGameDownloadModal } from '../lib/gameDownloadModal';
import { useT } from '../lib/i18n';
import { parseDbTime } from '../lib/dbTime';
import type { InstallLibraryWithDisk } from '../types/install-library';
import { formatPlaytime, statusColor, statusKey } from '../types/library';
import type { SamCategory } from '../types/sam';

function categoryLabelKey(cat: SamCategory): string {
  return `libdetail.category.${cat}`;
}

export function LibraryGamePage() {
  const { t } = useT();
  const { isOffline } = useOffline();
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  // Actions and library changes anywhere in the app refresh this page in
  // place; only opening another game shows the loading state.
  const { state, sessions: playSessions, libraryId: currentLibId, refresh: reload } =
    useLibraryGame(threadId);
  const storeDetail = useStoreDetail(threadId, isOffline);
  const onContentClick = useF95ContentLinks();
  /** null = not edited: the textarea shows the saved notes. */
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [tagDraft, setTagDraft] = useState('');
  const [launching, setLaunching] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moveInFlight, setMoveInFlight] = useState<{
    destPath: string;
    totalBytes: number;
  } | null>(null);
  const { running, launch } = useRunningGames();
  const isRunning = threadId ? running.has(threadId) : false;

  const { openLibraryDetailContextMenu } = useLibraryGameActions({ onReload: reload });

  // Notes save themselves a moment after typing stops (and on blur).
  const savedNotes = state.kind === 'ready' ? state.game.notes : null;
  const notesRef = useRef<{ draft: string | null; saved: string | null }>({
    draft: null,
    saved: null,
  });
  notesRef.current = { draft: notesDraft, saved: savedNotes };
  useEffect(() => {
    if (notesDraft === null || savedNotes === null || notesDraft === savedNotes) return;
    const timer = setTimeout(() => void saveNotes(), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesDraft, savedNotes]);
  // Another game (or leaving the page): keep what was typed. The id is the
  // one this effect ran for; the ref still holds that game's draft.
  useEffect(() => {
    setNotesDraft(null);
    setNotesStatus('idle');
    const id = threadId;
    return () => {
      const { draft, saved } = notesRef.current;
      if (id && draft !== null && draft !== saved) {
        void library.setNotes(id, draft).catch(() => undefined);
      }
    };
  }, [threadId]);

  useEffect(
    () => () => {
      clearRemoteImageQueue();
      clearGridPreviewCache();
    },
    [],
  );

  // Starting a game opens a session, which does not go through the library.
  useEffect(() => {
    if (state.kind === 'ready') void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  if (state.kind === 'loading') {
    return (
      <Shell>
        <GameDetailLoading />
      </Shell>
    );
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <GameDetailError message={describeIpcError(state.error, t)} onRetry={() => void reload()} />
      </Shell>
    );
  }

  if (state.kind === 'missing') {
    return (
      <Shell>
        <div className="game-detail-state">
          {t('libdetail.missing')}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="game-detail-btn game-detail-btn-secondary"
              onClick={() => navigate('/library')}
            >
              {t('libdetail.missing.back')}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const g = state.game;
  const bannerUrl = storeDetail?.bannerUrl ?? g.thumbnailUrl;
  const sanitized = storeDetail?.descriptionHtml ? sanitizeF95Html(storeDetail.descriptionHtml) : '';
  const changelog = storeDetail?.changelogHtml ? sanitizeF95Html(storeDetail.changelogHtml) : '';
  const notesValue = notesDraft ?? g.notes;

  async function onPickExe() {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: t('libdetail.action.pickExeTitle', { title: g.title }),
      filters: [
        { name: t('libdetail.location.exe'), extensions: ['exe', 'sh', 'app', 'bat', 'cmd'] },
        { name: 'All', extensions: ['*'] },
      ],
    });
    if (typeof selected !== 'string') return;
    await library.setExe(g.threadId, selected);
    await reload();
  }

  async function onClearExe() {
    const ok = await dialog.confirm(t('libdetail.confirmClearExe'), {
      title: t('libdetail.confirmClearExeTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    await library.clearExe(g.threadId);
    await reload();
  }

  async function onRemove() {
    const ok = await dialog.confirm(t('libdetail.confirmRemove', { title: g.title }), {
      title: t('libdetail.confirmRemoveTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    await library.remove(g.threadId);
    navigate('/library');
  }

  async function saveNotes() {
    const draft = notesDraft;
    if (draft === null || draft === g.notes) return;
    setNotesStatus('saving');
    try {
      await library.setNotes(g.threadId, draft);
      await reload();
      setNotesStatus('saved');
    } catch (err) {
      setNotesStatus('idle');
      await dialog.alert(formatIpcError(err), { kind: 'error' });
    }
  }

  async function onAddTag() {
    const tag = tagDraft.trim();
    if (!tag) return;
    if (g.customTags.includes(tag)) {
      setTagDraft('');
      return;
    }
    await library.setCustomTags(g.threadId, [...g.customTags, tag]);
    setTagDraft('');
    await reload();
  }

  async function onRemoveTag(tag: string) {
    await library.setCustomTags(
      g.threadId,
      g.customTags.filter((t) => t !== tag),
    );
    await reload();
  }

  async function onOpenInstallFolder() {
    if (!g.installPath) return;
    try {
      await ipc.revealInExplorer(g.installPath);
    } catch (err) {
      console.warn('open install folder failed', err);
    }
  }

  async function onPlay() {
    if (!g.exePath) {
      await dialog.alert(t('libdetail.play.needExe'));
      return;
    }
    if (isRunning) return;
    setLaunching(true);
    try {
      // Goes through the context's `launch` helper so the Hydra-style
      // overlay shows up while the game spawns. The overlay clears
      // itself once `game:started` fires.
      await launch(g);
      await reload();
    } catch (err) {
      await dialog.alert(t('libdetail.play.failed', { error: formatError(err) }));
    } finally {
      setLaunching(false);
    }
  }

  async function onStop() {
    try {
      await ipc.stopGame(g.threadId);
    } catch (err) {
      await dialog.alert(t('libdetail.stop.failed', { error: formatError(err) }));
    }
  }

  async function onCheckUpdate() {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    try {
      const result = await updates.checkOne(g);
      await reload();
      if (result.error) {
        await dialog.alert(t('libdetail.update.failed', { error: result.error }));
      } else if (result.hasUpdate) {
        await dialog.alert(t('libdetail.update.found', { version: result.latestVersion ?? '' }));
      } else {
        await dialog.alert(t('libdetail.update.uptodate'));
      }
    } catch (err) {
      await dialog.alert(t('libdetail.update.generic', { error: formatError(err) }));
    }
  }

  function onUpdateNow() {
    // Modal de escolha de host — atualiza sem sair da página do jogo.
    openGameDownloadModal({
      threadId: g.threadId,
      category: g.category,
      mode: 'update',
      title: g.title,
      versionLabel: g.availableVersion,
    });
  }

  function onOpenViewer() {
    navigate(`/library/game/${g.threadId}/view`);
  }

  const isGame = g.category === 'games';
  const canOpenViewer =
    !isGame &&
    !!g.installPath &&
    (g.installStatus === 'installed' || g.installStatus === 'update_available');

  async function onMoveLibraryPicked(lib: InstallLibraryWithDisk) {
    setMovePickerOpen(false);
    if (!g.installPath) return;
    if (isRunning) {
      await dialog.alert(t('libdetail.move.notRunning'));
      return;
    }
    try {
      const result = await ipc.moveInstallStart({
        threadId: g.threadId,
        oldInstallPath: g.installPath,
        oldExePath: g.exePath,
        newLibraryPath: lib.path,
      });
      setMoveInFlight({
        destPath: result.destInstallPath,
        totalBytes: result.totalBytes,
      });
    } catch (err) {
      await dialog.alert(t('libdetail.move.failed', { error: formatError(err) }));
    }
  }

  async function onMoveComplete(args: {
    newInstallPath: string;
    newExePath: string | null;
  }) {
    try {
      await library.setInstallPath(g.threadId, args.newInstallPath);
      if (args.newExePath) {
        await library.setExe(g.threadId, args.newExePath);
      }
    } catch (err) {
      console.warn('[move] failed to repoint DB', err);
    }
    setMoveInFlight(null);
    await reload();
  }

  async function onMoveClosed(reason: 'cancelled' | 'error', message?: string) {
    setMoveInFlight(null);
    if (reason === 'error' && message) {
      await dialog.alert(t('libdetail.move.error', { error: message }), { kind: 'error' });
    }
  }

  const hasInstallFiles = !!(g.installPath || g.exePath);
  const canUninstall =
    hasInstallFiles &&
    !isRunning &&
    g.installStatus !== 'downloading' &&
    g.installStatus !== 'extracting';

  async function onUninstall() {
    if (isRunning) {
      await dialog.alert(t('libdetail.uninstall.notRunning'));
      return;
    }
    if (g.installStatus === 'downloading' || g.installStatus === 'extracting') {
      await dialog.alert(t('libdetail.uninstall.waitDownload'));
      return;
    }
    const ok = await dialog.confirm(t('libdetail.confirmUninstall', { title: g.title }), {
      title: t('libdetail.confirmUninstallTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    setUninstalling(true);
    try {
      const result = await uninstall.uninstallGame(g.threadId);
      const removeFromLibrary = await dialog.ask(
        t('libdetail.uninstall.askRemoveLibrary', { title: g.title }),
        {
          title: t('libdetail.uninstall.askRemoveLibraryTitle'),
          kind: 'warning',
        },
      );
      if (removeFromLibrary) {
        await library.remove(g.threadId);
        navigate('/library');
        return;
      }
      await reload();
      if (result.skippedPaths.length > 0) {
        await dialog.alert(t('libdetail.uninstall.partial', { paths: result.skippedPaths.join('\n') }));
      } else if (!result.deleted && hasInstallFiles) {
        await dialog.alert(t('libdetail.uninstall.outsideLibrary'));
      }
    } catch (err) {
      await dialog.alert(t('libdetail.uninstall.failed', { error: formatError(err) }));
    } finally {
      setUninstalling(false);
    }
  }

  const statusBg = isRunning ? 'var(--status-success)' : statusColor(g.installStatus);

  return (
    <Shell
      onContextMenu={(e) =>
        openLibraryDetailContextMenu(e, g, {
          onPickExe,
          onOpenStore: onUpdateNow,
        })
      }
    >
      <GameDetailHero
        bannerUrl={bannerUrl}
        coverUrl={g.thumbnailUrl ?? bannerUrl}
        badges={
          <>
            <span
              className="game-detail-prefix"
              style={{ background: 'var(--border-strong)' }}
            >
              {t(categoryLabelKey(g.category))}
            </span>
            <span
              className="game-detail-prefix"
              style={{ background: statusBg }}
            >
              {isRunning ? t('libdetail.running') : t(statusKey(g.installStatus))}
            </span>
          </>
        }
        title={g.title}
        meta={
          <>
            {g.currentVersion && (
              <GameDetailChip accent title={t('libdetail.location.version')}>
                {g.currentVersion}
              </GameDetailChip>
            )}
            {g.availableVersion && g.availableVersion !== g.currentVersion && (
              <GameDetailChip title={t('libdetail.location.available')}>
                → {g.availableVersion}
              </GameDetailChip>
            )}
            {storeDetail?.developer && (
              <DeveloperChip name={storeDetail.developer} category={g.category} />
            )}
          </>
        }
        actions={
          isGame ? (
            <>
              {isRunning ? (
                <GameDetailBtnPrimary
                  onClick={onStop}
                  className="game-detail-btn-stop"
                >
                  {t('libdetail.action.stop')}
                </GameDetailBtnPrimary>
              ) : g.availableVersion &&
                g.installStatus === 'update_available' &&
                !g.exePath ? (
                // Sem exe não há o que jogar — o update segue como primário.
                <GameDetailBtnPrimary
                  onClick={onUpdateNow}
                  className="game-detail-btn-update"
                  title={t('libdetail.action.update.title', {
                    version: g.availableVersion,
                  })}
                >
                  {t('libdetail.action.update', { version: g.availableVersion })}
                </GameDetailBtnPrimary>
              ) : (
                // Jogar continua primário mesmo com update pendente — a versão
                // instalada nunca fica injogável por causa de um update.
                <>
                  <GameDetailBtnPrimary
                    onClick={onPlay}
                    disabled={!g.exePath || launching}
                    title={
                      !g.exePath
                        ? t('libdetail.action.play.hintExe')
                        : launching
                          ? t('libdetail.action.play.hintLaunch')
                          : t('libdetail.action.play.title')
                    }
                  >
                    {launching ? t('libdetail.action.launching') : t('libdetail.action.play')}
                  </GameDetailBtnPrimary>
                  {g.availableVersion && g.installStatus === 'update_available' && (
                    <GameDetailBtnSecondary
                      onClick={onUpdateNow}
                      className="game-detail-btn-update"
                      title={t('libdetail.action.update.title', {
                        version: g.availableVersion,
                      })}
                    >
                      {t('libdetail.action.update', { version: g.availableVersion })}
                    </GameDetailBtnSecondary>
                  )}
                </>
              )}
              <GameDetailBtnSecondary onClick={onPickExe}>
                {g.exePath ? t('libdetail.action.switchExe') : t('libdetail.action.setExe')}
              </GameDetailBtnSecondary>
              <GameDetailBtnSecondary onClick={onCheckUpdate}>
                {t('libdetail.action.checkUpdate')}
              </GameDetailBtnSecondary>
            </>
          ) : (
            <>
              {canOpenViewer && (
                <GameDetailBtnPrimary onClick={onOpenViewer}>
                  {t('libdetail.action.openViewer')}
                </GameDetailBtnPrimary>
              )}
              {g.category === 'mods' && g.exePath && (
                <GameDetailBtnSecondary onClick={onPlay} disabled={launching}>
                  {launching ? t('libdetail.action.launching') : t('libdetail.action.play')}
                </GameDetailBtnSecondary>
              )}
              <GameDetailBtnSecondary onClick={onOpenInstallFolder}>
                {t('common.open')}
              </GameDetailBtnSecondary>
            </>
          )
        }
      />

      <GameDetailStatGrid>
        <GameDetailStat
          label={t('libdetail.location.status')}
          value={isRunning ? t('libdetail.running') : t(statusKey(g.installStatus))}
          highlight={isRunning}
        />
        {isGame && (
          <GameDetailStat
            label={t('libdetail.stats.playtime')}
            value={formatPlaytime(g.totalPlaytimeSeconds)}
          />
        )}
        <GameDetailStat
          label={t('libdetail.location.version')}
          value={g.currentVersion ?? '—'}
          highlight={!!g.availableVersion && g.availableVersion !== g.currentVersion}
        />
        {isGame && (
          <>
            <GameDetailStat
              label={t('libdetail.stats.sessions')}
              value={playSessions.total}
            />
            {g.lastPlayedAt && (
              <GameDetailStat
                label={t('libdetail.stats.lastPlayed')}
                value={parseDbTime(g.lastPlayedAt)?.toLocaleDateString() ?? '—'}
              />
            )}
          </>
        )}
      </GameDetailStatGrid>

      <GameDetailBody>
        <GameDetailMain>
          {storeDetail && storeDetail.screenshots.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.screenshots')}>
              <ScreenshotGallery images={storeDetail.screenshots} />
            </GameDetailSection>
          )}

          {sanitized && (
            <GameDetailSection title={t('gamedetail.section.about')}>
              <div onClick={onContentClick}>
                <GameDescription
                  html={sanitized}
                  style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
                />
              </div>
            </GameDetailSection>
          )}

          {changelog && (
            <GameDetailSection title={t('gamedetail.section.changelog')}>
              <div onClick={onContentClick}>
                <CollapsibleHtml html={changelog} />
              </div>
            </GameDetailSection>
          )}

          {storeDetail && storeDetail.tags.length > 0 && (
            <GameDetailSection title={t('libdetail.section.f95Tags')}>
              <StoreTagList tags={storeDetail.tags} category={g.category} />
            </GameDetailSection>
          )}

          {isGame && (
            <GameAchievementsSection
              game={g}
              storeDetail={storeDetail}
              onChanged={() => void reload()}
            />
          )}

          <GameDetailSection title={t('libdetail.section.notes')}>
            <textarea
              value={notesValue}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                setNotesStatus('idle');
              }}
              onBlur={() => void saveNotes()}
              placeholder={t('libdetail.notes.placeholder')}
              rows={6}
              className="game-detail-notes"
            />
            <div className="game-detail-notes-status" aria-live="polite">
              {notesStatus === 'saving'
                ? t('common.saving')
                : notesStatus === 'saved'
                  ? t('libdetail.notes.saved')
                  : ''}
            </div>
          </GameDetailSection>

          {isGame && (
          <GameDetailSection title={t('libdetail.section.sessions')}>
            {playSessions.recent.length === 0 ? (
              <div className="game-detail-empty-hint">{t('libdetail.sessions.empty')}</div>
            ) : (
              <ul className="game-detail-session-list">
                {playSessions.recent.map((s) => (
                  <li key={s.id} className="game-detail-session-row">
                    <span className="game-detail-session-when">
                      {parseDbTime(s.startedAt)?.toLocaleString()}
                    </span>
                    <span className="game-detail-session-dur">
                      {s.endedAt
                        ? formatPlaytime(s.durationSeconds ?? 0)
                        : isRunning
                          ? t('libdetail.sessions.running')
                          : t('libdetail.sessions.interrupted')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GameDetailSection>
          )}

          <GameDetailSection title={t('libdetail.section.tags')}>
            <div className="game-detail-tags">
              {g.customTags.length === 0 && (
                <span className="game-detail-empty-hint">{t('libdetail.tags.empty')}</span>
              )}
              {g.customTags.map((tag) => (
                <span key={tag} className="game-detail-custom-tag">
                  {tag}
                  <button
                    type="button"
                    onClick={() => onRemoveTag(tag)}
                    className="game-detail-tag-remove"
                    aria-label={t('common.remove')}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="game-detail-tag-input-row">
              <input
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAddTag();
                }}
                placeholder={t('libdetail.tags.input')}
                className="game-detail-tag-input"
              />
              <button type="button" onClick={onAddTag} className="game-detail-tag-add">
                {t('common.add')}
              </button>
            </div>
          </GameDetailSection>
        </GameDetailMain>

        <GameDetailAside>
          <GameDetailSection title={t('libdetail.section.location')}>
            <GameDetailFields>
              <GameDetailField
                label={t('libdetail.location.exe')}
                value={g.exePath ?? '—'}
                actionLabel={g.exePath ? t('common.clear') : undefined}
                onAction={onClearExe}
              />
              <GameDetailField
                label={t('libdetail.location.folder')}
                value={g.installPath ?? '—'}
                actionLabel={g.installPath ? t('common.open') : undefined}
                onAction={onOpenInstallFolder}
              />
              <GameDetailField
                label={t('libdetail.location.added')}
                value={parseDbTime(g.addedAt)?.toLocaleString() ?? '—'}
              />
            </GameDetailFields>

            {hasInstallFiles && (
              <div className="game-detail-uninstall-block">
                <p className="game-detail-uninstall-hint">
                  {t('libdetail.uninstall.hint')}
                </p>
                <GameDetailBtnDanger
                  onClick={onUninstall}
                  disabled={!canUninstall || uninstalling}
                  title={
                    isRunning
                      ? t('libdetail.uninstall.notRunning')
                      : g.installStatus === 'downloading' || g.installStatus === 'extracting'
                        ? t('libdetail.uninstall.waitDownload')
                        : t('libdetail.action.uninstall.title')
                  }
                >
                  {uninstalling
                    ? t('libdetail.action.uninstalling')
                    : t('libdetail.action.uninstall')}
                </GameDetailBtnDanger>
              </div>
            )}
          </GameDetailSection>

          {storeDetail && (
            <GameDetailSection title={t('gamedetail.section.info')}>
              <StoreInfoFields detail={storeDetail} category={g.category} omit={['Version']} />
            </GameDetailSection>
          )}

          <InstallVersionsSection game={g} onChanged={reload} />

          <GameDetailSection title={t('libdetail.section.actions')}>
            <GameDetailActionList>
              <GameDetailActionItem to={`/store/game/${g.threadId}?cat=${g.category}`}>
                {t('libdetail.action.viewStore')}
              </GameDetailActionItem>
              <GameDetailActionItem onClick={() => openUrl(g.threadUrl)}>
                {t('libdetail.action.openThread')}
              </GameDetailActionItem>
              {g.installPath && (
                <GameDetailActionItem
                  disabled={isRunning}
                  title={
                    isRunning
                      ? t('libdetail.action.move.disabledTitle')
                      : t('libdetail.action.move.title')
                  }
                  onClick={() => setMovePickerOpen(true)}
                >
                  {t('libdetail.action.move')}
                </GameDetailActionItem>
              )}
              <GameDetailActionItem onClick={onRemove} danger>
                {t('libdetail.action.removeFromLibrary')}
              </GameDetailActionItem>
            </GameDetailActionList>
          </GameDetailSection>
        </GameDetailAside>
      </GameDetailBody>

      <InstallLocationModal
        open={movePickerOpen}
        title={t('libdetail.move.modalTitle', { title: g.title })}
        description={<span>{t('libdetail.move.modalHint')}</span>}
        primaryLabel={t('libdetail.move.modalConfirm')}
        excludeLibraryId={currentLibId}
        onCancel={() => setMovePickerOpen(false)}
        onConfirm={onMoveLibraryPicked}
      />

      {moveInFlight && (
        <MoveProgressModal
          open
          threadId={g.threadId}
          totalBytesHint={moveInFlight.totalBytes}
          destPath={moveInFlight.destPath}
          onComplete={onMoveComplete}
          onClosed={onMoveClosed}
        />
      )}
    </Shell>
  );
}

function Shell({
  children,
  onContextMenu,
}: {
  children: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  const libraryHref = useSectionHref('/library');
  return (
    <GameDetailShell onContextMenu={onContextMenu}>
      <GameDetailBackBar
        onBack={() => (location.key !== 'default' ? navigate(-1) : navigate(libraryHref))}
        breadcrumbTo={libraryHref}
        breadcrumbLabel={t('nav.library')}
      />
      {children}
    </GameDetailShell>
  );
}

/** Developer from the F95 thread, opening their other games in the store. */
function DeveloperChip({ name, category }: { name: string; category: SamCategory }) {
  const { t } = useT();
  const to = useStoreLinks(category).developer(name);
  if (!to) return <GameDetailChip>{name}</GameDetailChip>;
  return (
    <Link
      to={to}
      className="game-detail-chip game-detail-chip-link"
      title={t('gamedetail.moreFrom', { name })}
    >
      {name}
    </Link>
  );
}

const formatError = formatIpcError;
