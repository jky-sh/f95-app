import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRunningGames } from '../../../contexts/RunningGames';
import { item, sep } from '../../../lib/contextMenus/helpers';
import { parseDbTime } from '../../../lib/dbTime';
import { dialog } from '../../../lib/dialog';
import { useT } from '../../../lib/i18n';
import * as installVersions from '../../../lib/installVersions';
import { engineLabel, type InstallVersion } from '../../../lib/installVersions';
import * as ipc from '../../../lib/ipc';
import { formatDay } from '../../../lib/memberPresence';
import { formatBytes } from '../../../types/download';
import type { LibraryGame } from '../../../types/library';
import { Icon } from '../../ui/Icon';
import { useBp } from '../BpContext';
import { focusElement, rememberGroupFocus } from '../bpInput';

/** The F95 label ("v0.3.2"), else the folder name, as on the desktop page. */
export function versionLabel(v: InstallVersion): string {
  if (v.version) return v.version;
  return v.installPath.split(/[/\\]/).pop() || v.installPath;
}

function formatErr(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

/** Stacked layers (Lucide): the shared icon set has no glyph for versions. */
export function BpVersionsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

/**
 * The game's installed versions, newest first. Reloaded whenever its library
 * row changes (useLibraryGame hands a new object then), so activating or
 * deleting a version shows on the next refresh. Listed whatever the game's
 * status, like the desktop page: while an update downloads or after it
 * failed is exactly when an older version is wanted.
 */
export function useInstallVersions(game: LibraryGame | null): InstallVersion[] {
  const [versions, setVersions] = useState<InstallVersion[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!game) return;
    const id = ++seq.current;
    installVersions
      .listForGame(game)
      .then((list) => {
        if (id === seq.current) setVersions(list);
      })
      .catch((err) => {
        console.warn('[big-picture] versions list failed', err);
        if (id === seq.current) setVersions([]);
      });
  }, [game]);

  return versions;
}

/** Focus the active version's row (the hero's version button jumps there). */
export function focusActiveVersion(container: HTMLElement | null): void {
  const row =
    container?.querySelector<HTMLElement>('.bp-version.is-active') ??
    container?.querySelector<HTMLElement>('.bp-version');
  if (row) focusElement(row);
}

/**
 * Every installed version as a row: A plays it (or makes it active when it
 * can't be played right now), X opens the rest (play, make active, folder,
 * delete), like the desktop page's versions section.
 */
export function BpVersions({
  game,
  versions,
  onChanged,
}: {
  game: LibraryGame;
  versions: InstallVersion[];
  /** After making one active or deleting one: the page reloads the game row. */
  onChanged: () => Promise<void>;
}) {
  const { t, locale } = useT();
  const bp = useBp();
  const { running, launch } = useRunningGames();
  const [busyId, setBusyId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Set when a delete removes the focused row: land on the active one instead. */
  const refocusActive = useRef(false);
  const group = `game-versions-${game.threadId}`;
  const isRunning = running.has(game.threadId);
  const activeId = versions.find((v) => v.active)?.id ?? null;

  const rowOf = (id: number) =>
    listRef.current?.querySelector<HTMLElement>(`[data-bp-id="${group}:${id}"]`) ?? null;

  // Down from the tab row lands on the active version, not just the nearest
  // row (entering a group goes back to the control it remembers).
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('.bp-version.is-active');
    if (row) rememberGroupFocus(row);
  }, [activeId]);

  useLayoutEffect(() => {
    if (!refocusActive.current) return;
    refocusActive.current = false;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost) focusActiveVersion(listRef.current);
  }, [versions]);

  /** The app's dialogs sit outside Big Picture and drop the focus as they close. */
  function refocus(id: number) {
    requestAnimationFrame(() => {
      const row = rowOf(id);
      const lost = !document.activeElement || document.activeElement === document.body;
      if (row && lost) focusElement(row, { scroll: false });
    });
  }

  const canPlay = (v: InstallVersion) => game.category === 'games' && v.exePath != null;

  async function play(v: InstallVersion) {
    if (!v.exePath || isRunning) return;
    try {
      await launch(game, v.exePath);
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
      refocus(v.id);
    }
  }

  async function activate(v: InstallVersion) {
    setBusyId(v.id);
    try {
      await installVersions.setActive(game, v);
      await onChanged();
    } catch (err) {
      await dialog.alert(formatErr(err), { kind: 'error' });
      refocus(v.id);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(v: InstallVersion) {
    const size = v.sizeBytes != null ? formatBytes(v.sizeBytes) : '?';
    const ok = await dialog.confirm(t('libdetail.versions.confirmDelete', { label: versionLabel(v), size }), {
      title: t('libdetail.versions.title'),
      kind: 'warning',
      confirmLabel: t('common.delete'),
    });
    refocus(v.id);
    if (!ok) return;
    setBusyId(v.id);
    try {
      const result = await installVersions.deleteVersion(v);
      if (!result.deleted && result.skippedPath) {
        await dialog.alert(t('libdetail.uninstall.partial', { paths: result.skippedPath }));
        refocus(v.id);
      }
      refocusActive.current = result.deleted;
      await onChanged();
    } catch (err) {
      const message =
        err instanceof installVersions.ActiveInstallError
          ? t('libdetail.versions.delete.blockedActive')
          : formatErr(err);
      await dialog.alert(message, { kind: 'error' });
      refocus(v.id);
    } finally {
      setBusyId(null);
    }
  }

  function openOptions(v: InstallVersion) {
    bp.openSheet({
      title: versionLabel(v),
      subtitle: game.title,
      art: game.thumbnailUrl,
      items: [
        item('play', t('bp.game.versions.play'), () => play(v), {
          hidden: !canPlay(v),
          disabled: isRunning,
          title: isRunning ? t('libdetail.versions.play.blockedRunning') : t('libdetail.versions.play.title'),
        }),
        item('activate', t('libdetail.versions.makeActive'), () => activate(v), {
          hidden: v.active,
          title: t('libdetail.versions.makeActive.title'),
        }),
        item('folder', t('contextMenu.openFolder'), async () => {
          try {
            await ipc.revealInExplorer(v.installPath);
          } catch (err) {
            await dialog.alert(formatErr(err), { kind: 'error' });
            refocus(v.id);
          }
        }),
        sep('sep-delete'),
        item('delete', t('common.delete'), () => remove(v), {
          danger: true,
          disabled: v.active || isRunning || busyId === v.id,
          title: v.active
            ? t('libdetail.versions.delete.blockedActive')
            : isRunning
              ? t('libdetail.versions.play.blockedRunning')
              : t('libdetail.versions.delete.title'),
        }),
      ],
    });
  }

  /** A: play this version when it can run now, else make it the active one. */
  function accept(v: InstallVersion) {
    if (busyId != null) return;
    if (canPlay(v) && !isRunning) void play(v);
    else if (!v.active) void activate(v);
    else openOptions(v);
  }

  function acceptLabel(v: InstallVersion): string {
    if (canPlay(v) && !isRunning) return t('libdetail.action.play');
    if (!v.active) return t('libdetail.versions.makeActive');
    return t('bp.hint.options');
  }

  return (
    <div className="bp-versions">
      <div className="bp-install-rows" ref={listRef} data-bp-group={group}>
        {versions.map((v) => {
          const installed = parseDbTime(v.installedAt);
          const details = [
            v.engine ? engineLabel(v.engine) : null,
            v.sizeBytes != null && v.sizeBytes > 0 ? formatBytes(v.sizeBytes) : null,
          ].filter(Boolean);
          return (
            <button
              key={v.id}
              type="button"
              className={`bp-install-row bp-version bp-focusable${v.active ? ' is-active' : ''}`}
              data-bp-id={`${group}:${v.id}`}
              data-bp-a={acceptLabel(v)}
              data-bp-x={t('bp.hint.options')}
              data-bp-autofocus={v.active || undefined}
              aria-busy={busyId === v.id || undefined}
              title={v.installPath}
              onClick={() => accept(v)}
              onContextMenu={(e) => {
                e.preventDefault();
                openOptions(v);
              }}
            >
              <Icon name="hardDrive" size={24} />
              <span className="bp-install-row-text">
                <span className="bp-install-row-name">
                  {versionLabel(v)}
                  {v.active && <span className="bp-badge bp-badge--good">{t('libdetail.versions.active')}</span>}
                </span>
                {details.length > 0 && <span className="bp-install-row-sub">{details.join(' · ')}</span>}
                <span className="bp-install-row-sub bp-install-row-sub--path">{v.installPath}</span>
              </span>
              <span className="bp-install-row-aside">
                {busyId === v.id ? (
                  <span className="bp-spinner" aria-hidden />
                ) : installed ? (
                  formatDay(installed.getTime(), locale)
                ) : (
                  '—'
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="bp-muted bp-versions-hint">{t('libdetail.versions.hint')}</p>
    </div>
  );
}
