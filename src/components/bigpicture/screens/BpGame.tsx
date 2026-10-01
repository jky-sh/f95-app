import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOffline } from '../../../contexts/Offline';
import { useRunningGames, useRunningSince } from '../../../contexts/RunningGames';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useLibraryGame } from '../../../hooks/useLibraryGame';
import { useNow } from '../../../hooks/useNow';
import { useStoreDetail } from '../../../hooks/useStoreDetail';
import { parseDbTime } from '../../../lib/dbTime';
import { openGameDownloadModal } from '../../../lib/gameDownloadModal';
import { useT } from '../../../lib/i18n';
import { primaryCta, type LibraryCtaIntent } from '../../../lib/libraryCta';
import { openUpdateModal, playOrStop } from '../../../lib/libraryGameActions';
import { formatDay, formatWhen } from '../../../lib/memberPresence';
import { formatBytes } from '../../../types/download';
import { formatPlaytime, statusKey, type LibraryGame } from '../../../types/library';
import { Icon, type IconName } from '../../ui/Icon';
import { useBp } from '../BpContext';
import { rememberGroupFocus } from '../bpInput';
import { BpDownloadButton } from '../BpInstall';
import { BpEmpty, BpLoader, BpSubTabs, formatElapsed, markWholeArt, useProgressiveArt } from '../BpParts';
import {
  BpAchievements,
  BpFacts,
  BpReadingBlock,
  BpScreenshotGrid,
  BpTagList,
  changelogOf,
  overviewOf,
  useGameAchievements,
  useThreadFacts,
} from './BpGameParts';
import { BpVersions, BpVersionsIcon, focusActiveVersion, useInstallVersions, versionLabel } from './BpVersions';

type GameTab = 'overview' | 'achievements' | 'screenshots' | 'changelog' | 'activity' | 'versions';

const RECENT_SESSIONS = 8;

export function ctaIcon(intent: LibraryCtaIntent, game: LibraryGame): IconName {
  if (intent === 'stop') return 'stop';
  if (intent === 'update') return 'download';
  if (intent === 'pick-exe') return 'folder';
  if (intent === 'view') return game.category === 'comics' ? 'book' : game.category === 'animations' ? 'film' : 'image';
  return 'play';
}

/** A library game: its art across the top, Play first, the rest in tabs. */
export function BpGame({ threadId }: { threadId: string }) {
  const { t, locale } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();
  const { state, sessions, sizeBytes, refresh } = useLibraryGame(threadId);
  const detail = useStoreDetail(threadId, isOffline);
  const { running } = useRunningGames();
  const since = useRunningSince(threadId);
  // The session clock ticks only while the game runs.
  const now = useNow(since ? 1000 : 60_000);
  const download = useDownloadsByThread().get(threadId);
  const [tab, setTab] = useState<GameTab>('overview');

  const game = state.kind === 'ready' ? state.game : null;
  const art = useProgressiveArt(game?.thumbnailUrl ?? null);
  const achievements = useGameAchievements(game?.category === 'games' ? game : null);
  const overview = useMemo(() => (detail ? overviewOf(detail.descriptionHtml) : []), [detail]);
  const changelog = useMemo(() => (detail?.changelogHtml ? changelogOf(detail.changelogHtml) : []), [detail]);
  const facts = useThreadFacts(detail);
  const versions = useInstallVersions(game);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Bumped by the hero's version button: open the Versions tab on the active row. */
  const [versionsJump, setVersionsJump] = useState(0);

  useEffect(() => bp.setBackdrop(game?.thumbnailUrl ?? null), [bp, game?.thumbnailUrl]);

  useLayoutEffect(() => {
    if (!versionsJump) return;
    // Up from the row goes back to the Versions tab, not whichever is nearest.
    const tab = panelRef.current?.parentElement?.querySelector<HTMLElement>(".bp-subtab[aria-selected='true']");
    if (tab) rememberGroupFocus(tab);
    focusActiveVersion(panelRef.current);
  }, [versionsJump]);

  if (state.kind === 'loading') {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpLoader label={t('common.loading')} />
      </div>
    );
  }
  if (!game) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpEmpty
          icon="alert"
          title={t('bp.game.missing')}
          action={
            <button type="button" className="bp-btn bp-focusable" data-bp-autofocus="" onClick={bp.back}>
              {t('bp.hint.back')}
            </button>
          }
        />
      </div>
    );
  }

  const isRunning = running.has(game.threadId);
  const cta = primaryCta(game, isRunning, t);
  const last = parseDbTime(game.lastPlayedAt);
  const added = parseDbTime(game.addedAt);
  const hasUpdate = game.installStatus === 'update_available';
  const shots = detail?.screenshots ?? [];
  const isGame = game.category === 'games';
  // Not on disk yet (or the install failed): Install first, pointing at a
  // copy that is already there second.
  const canInstall = !download && (game.installStatus === 'not_installed' || game.installStatus === 'error');
  // Downloading, the usual action is a disabled "Downloading": the progress takes its place.
  const showProgress = download != null && cta.intent === 'noop';
  const ctaFirst = !canInstall && !showProgress;

  const tabs: { id: GameTab; label: string; count?: string | number | null }[] = [
    { id: 'overview', label: t('bp.game.tab.overview') },
    ...(isGame
      ? [
          {
            id: 'achievements' as const,
            label: t('bp.game.tab.achievements'),
            count: achievements.total ? `${achievements.unlocked}/${achievements.total}` : null,
          },
        ]
      : []),
    ...(shots.length ? [{ id: 'screenshots' as const, label: t('bp.game.screenshots'), count: shots.length }] : []),
    ...(changelog.length ? [{ id: 'changelog' as const, label: t('bp.game.tab.changelog') }] : []),
    { id: 'activity', label: t('bp.game.tab.activity') },
    ...(versions.length > 1
      ? [{ id: 'versions' as const, label: t('bp.game.tab.versions'), count: versions.length }]
      : []),
  ];
  const current = tabs.some((x) => x.id === tab) ? tab : 'overview';
  const activeVersion = versions.find((v) => v.active) ?? null;

  return (
    <div className="bp-screen-body bp-detail" data-bp-scroll-y="">
      <section className="bp-detail-hero" data-bp-snap="top">
        <div className="bp-game-art">
          {art && <img src={art} alt="" draggable={false} onLoad={markWholeArt} />}
        </div>
        <div className="bp-detail-head">
          <h1 className="bp-detail-title">{game.title}</h1>
          <div className="bp-meta">
            {isRunning ? (
              <span className="bp-badge bp-badge--live">
                {t('bp.badge.playing')}
                {since && ` · ${formatElapsed(now - since)}`}
              </span>
            ) : download ? (
              <span className="bp-badge bp-badge--progress">
                {download.phase === 'extracting' ? t('status.extracting') : t('status.downloading')}
                {download.percent != null && ` ${download.percent}%`}
              </span>
            ) : (
              game.installStatus !== 'installed' && (
                <span className={`bp-badge bp-badge--status-${game.installStatus}`}>
                  {t(statusKey(game.installStatus))}
                </span>
              )
            )}
            {detail?.developer && <span>{detail.developer}</span>}
            {game.currentVersion && <span>{game.currentVersion}</span>}
            {hasUpdate && game.availableVersion && (
              <span className="bp-meta-accent">{t('bp.updateTo', { version: game.availableVersion })}</span>
            )}
            {detail?.rating && (
              <span>
                <Icon name="star" size={15} /> {detail.rating.average.toFixed(1)}
              </span>
            )}
          </div>
          <div className="bp-actions" data-bp-group="game-actions" data-bp-row="">
            {canInstall && (
              <button
                type="button"
                className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
                data-bp-autofocus=""
                disabled={isOffline}
                onClick={() =>
                  openGameDownloadModal({
                    threadId: game.threadId,
                    category: game.category,
                    mode: 'install',
                    title: game.title,
                  })
                }
              >
                <Icon name="download" size={22} />
                {t('bp.store.install')}
              </button>
            )}
            {showProgress ? (
              <BpDownloadButton download={download} primary />
            ) : (
              !(canInstall && cta.disabled) && (
                <button
                  type="button"
                  className={`bp-btn${ctaFirst ? ` bp-btn--lg ${cta.intent === 'stop' ? 'bp-btn--stop' : 'bp-btn--primary'}` : ''} bp-focusable`}
                  data-bp-autofocus={ctaFirst ? '' : undefined}
                  data-bp-a={cta.label}
                  disabled={cta.disabled}
                  title={cta.title}
                  onClick={() => void playOrStop(game, bp.gameDeps())}
                >
                  <Icon name={ctaIcon(cta.intent, game)} size={ctaFirst ? 22 : 20} />
                  {cta.label}
                </button>
              )
            )}
            {versions.length > 1 && (
              <button
                type="button"
                className="bp-btn bp-btn-version bp-focusable"
                title={t('libdetail.versions.title')}
                data-bp-a={t('bp.game.versions.choose')}
                onClick={() => {
                  setTab('versions');
                  setVersionsJump((n) => n + 1);
                }}
              >
                <BpVersionsIcon size={20} />
                <span className="bp-btn-version-label">
                  {activeVersion ? versionLabel(activeVersion) : t('bp.game.tab.versions')}
                </span>
              </button>
            )}
            {download && !showProgress && <BpDownloadButton download={download} />}
            {hasUpdate && cta.intent !== 'update' && (
              <button
                type="button"
                className="bp-btn bp-focusable"
                disabled={isOffline}
                onClick={() => openUpdateModal(game)}
              >
                <Icon name="download" size={20} />
                {game.availableVersion ? t('bp.updateTo', { version: game.availableVersion }) : t('libcard.cta.update')}
              </button>
            )}
            <button
              type="button"
              className="bp-btn bp-focusable"
              onClick={() => bp.push({ screen: 'storeGame', threadId: game.threadId, category: game.category })}
            >
              <Icon name="store" size={20} />
              {t('bp.game.store')}
            </button>
            <button
              type="button"
              className="bp-btn bp-btn--icon bp-focusable"
              aria-label={t('bp.hint.options')}
              title={t('bp.hint.options')}
              data-bp-a={t('bp.hint.options')}
              onClick={() => bp.openGameOptions(game)}
            >
              <Icon name="more" size={24} strokeWidth={3} />
            </button>
          </div>
        </div>
      </section>

      <BpSubTabs id={`game-tabs-${game.threadId}`} tabs={tabs} active={current} onChange={setTab} />

      <div className="bp-panel" key={current} ref={panelRef}>
        {current === 'overview' && (
          <div className="bp-overview">
            {overview.length > 0 ? (
              <BpReadingBlock blocks={overview} />
            ) : (
              <p className="bp-muted">{detail ? t('bp.game.noDescription') : t('common.loading')}</p>
            )}
            <aside className="bp-overview-side">
              <BpFacts facts={facts} />
              <BpTagList tags={detail?.tags.map((tag) => tag.name) ?? []} />
            </aside>
          </div>
        )}
        {current === 'achievements' && <BpAchievements game={game} detail={detail} state={achievements} />}
        {current === 'screenshots' && <BpScreenshotGrid images={shots} />}
        {current === 'changelog' && <BpReadingBlock blocks={changelog} className="bp-read--log" />}
        {current === 'versions' && <BpVersions game={game} versions={versions} onChanged={refresh} />}
        {current === 'activity' && (
          <div className="bp-activity">
            <dl className="bp-stats">
              <div className="bp-stat">
                <dt>{t('bp.game.playtime')}</dt>
                <dd>{formatPlaytime(game.totalPlaytimeSeconds)}</dd>
              </div>
              <div className="bp-stat">
                <dt>{t('bp.game.lastPlayed')}</dt>
                <dd>{last ? formatWhen(last.getTime(), locale) : t('time.neverPlayed')}</dd>
              </div>
              <div className="bp-stat">
                <dt>{t('bp.game.sessions')}</dt>
                <dd>{sessions.total}</dd>
              </div>
              <div className="bp-stat">
                <dt>{t('bp.game.size')}</dt>
                <dd>{sizeBytes ? formatBytes(sizeBytes) : '—'}</dd>
              </div>
              <div className="bp-stat">
                <dt>{t('bp.game.added')}</dt>
                <dd>{added ? formatDay(added.getTime(), locale) : '—'}</dd>
              </div>
            </dl>
            {sessions.recent.length > 0 && (
              <ul className="bp-sessions">
                {sessions.recent.slice(0, RECENT_SESSIONS).map((s) => {
                  const started = parseDbTime(s.startedAt);
                  return (
                    <li key={s.id} className="bp-session bp-focusable" tabIndex={0}>
                      <span>
                        {started
                          ? started.toLocaleString(locale, {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </span>
                      <span className="bp-session-time">
                        {s.durationSeconds != null ? formatPlaytime(s.durationSeconds) : t('bp.badge.playing')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
