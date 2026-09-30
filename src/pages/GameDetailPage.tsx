import { useCallback, useEffect, useState } from 'react';
import { cacheThreadPrefixNames } from '../lib/prefixDisplayCache';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { parseSamCategory } from '../constants/samCategories';
import { openUrl } from '@tauri-apps/plugin-opener';
import { cachedGameDetail, loadGameDetail } from '../lib/gameDetailCache';
import { dialog } from '../lib/dialog';
import * as library from '../lib/library';
import { GameDescription } from '../components/game/GameDescription';
import {
  CollapsibleHtml,
  StoreInfoFields,
  StoreTagList,
  sanitizeF95Html,
  useF95ContentLinks,
} from '../components/game/StoreDetailSections';
import { clearGridPreviewCache } from '../lib/gridPreviewQueue';
import { clearRemoteImageQueue } from '../lib/remoteImageQueue';
import { ScreenshotGallery } from '../components/game/ScreenshotGallery';
import { StoreAchievementsSection } from '../components/game/StoreAchievementsSection';
import { DownloadLinks } from '../components/game/DownloadLinks';
import {
  GameDetailBackBar,
  GameDetailBody,
  GameDetailChip,
  GameDetailError,
  GameDetailHero,
  GameDetailLoading,
  GameDetailMain,
  GameDetailShell,
  GameDetailSection,
  GameDetailAside,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  PrefixPill,
} from '../components/game/GameDetailLayout';
import { OfflineGate } from '../components/OfflineGate';
import { Icon } from '../components/ui/Icon';
import { openGameDownloadModal } from '../lib/gameDownloadModal';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { buildStoreMenu } from '../lib/contextMenus/buildStoreMenu';
import { useT } from '../lib/i18n';
import { describeIpcError, formatIpcError } from '../lib/ipcError';
import { useStoreHref } from '../lib/storeQuery';
import { useLibraryIndex } from '../hooks/useLibraryIndex';
import { LibraryBadge, libraryBadgeKind } from '../components/store/LibraryBadge';
import { formatCount } from '../components/store/GameCard';
import { useStoreLinks } from '../hooks/useStoreLinks';
import { formatAgo, formatDay } from '../lib/memberPresence';
import type { GameDetail, GamePrefix } from '../types/game';
import type { SamGameCard } from '../types/sam';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ready'; data: GameDetail };

export function GameDetailPage() {
  return (
    <OfflineGate>
      <GameDetailPageInner />
    </OfflineGate>
  );
}

function GameDetailPageInner() {
  const { threadId } = useParams<{ threadId: string }>();
  const [searchParams] = useSearchParams();
  const category = parseSamCategory(searchParams.get('cat'));
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  const { isOffline } = useOffline();
  const storeLinks = useStoreLinks(category);
  const onContentClick = useF95ContentLinks();
  // Opened from a store card: its rating, likes and views (the thread page has none).
  const stateCard = (location.state as { card?: SamGameCard } | null)?.card;
  const cardStats = stateCard && stateCard.threadId === threadId ? stateCard : null;
  const { openMenuAt } = useContextMenu();
  const storeHref = useStoreHref();
  // Details seen a moment ago (Back from the library page, the download
  // modal) render in the first frame instead of a loading screen.
  const [state, setState] = useState<State>(() => {
    const hit = threadId ? cachedGameDetail(threadId) : null;
    return hit ? { kind: 'ready', data: hit } : { kind: 'loading' };
  });
  /** Bumped by the Retry button to run the fetch again. */
  const [attempt, setAttempt] = useState(0);
  // The library index follows adds, installs and update checks anywhere in
  // the app; `justAdded` covers the moment before it reloads.
  const libraryEntry = useLibraryIndex().get(threadId ?? '');
  const [justAdded, setJustAdded] = useState(false);
  const inLibrary = !!libraryEntry || justAdded;
  const [adding, setAdding] = useState(false);

  const openDetailContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      if (state.kind !== 'ready') return;
      e.preventDefault();
      e.stopPropagation();
      const data = state.data;
      const inLib = await library.isInLibrary(data.threadId);
      openMenuAt(
        e.clientX,
        e.clientY,
        buildStoreMenu(
          {
            threadId: data.threadId,
            title: data.title,
            threadUrl: data.threadUrl,
            thumbnailUrl: data.bannerUrl,
            version: data.version,
          },
          {
            navigate,
            category,
            isOffline,
            inLibrary: inLib,
            t,
            onLibraryChange: () => setJustAdded(true),
          },
        ),
      );
    },
    [state, navigate, category, isOffline, t, openMenuAt],
  );

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    // Retry skips the cache; otherwise details seen a moment ago are reused.
    const hit = attempt === 0 ? cachedGameDetail(threadId) : null;
    if (hit) {
      setState((prev) =>
        prev.kind === 'ready' && prev.data === hit ? prev : { kind: 'ready', data: hit },
      );
    } else {
      setState({ kind: 'loading' });
      loadGameDetail(threadId, { fresh: attempt > 0 })
        .then((data) => {
          if (!cancelled) setState({ kind: 'ready', data });
        })
        .catch((err) => {
          if (!cancelled) setState({ kind: 'error', error: err });
        });
    }
    setJustAdded(false);
    return () => {
      cancelled = true;
    };
  }, [threadId, attempt]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    cacheThreadPrefixNames(
      state.data.threadId,
      state.data.prefixes.map((p) => p.name),
    );
  }, [state]);

  useEffect(
    () => () => {
      clearRemoteImageQueue();
      clearGridPreviewCache();
    },
    [],
  );

  async function onAddToLibrary() {
    if (state.kind !== 'ready' || adding) return;
    setAdding(true);
    try {
      await library.add({
        threadId: state.data.threadId,
        category,
        title: state.data.title,
        threadUrl: state.data.threadUrl,
        thumbnailUrl: state.data.bannerUrl,
        currentVersion: state.data.version,
      });
      setJustAdded(true);
    } catch (err) {
      await dialog.alert(formatIpcError(err), { kind: 'error' });
    } finally {
      setAdding(false);
    }
  }

  function onInstall() {
    if (state.kind !== 'ready') return;
    // Reaproveita o detail já carregado — o modal abre sem novo scrape.
    openGameDownloadModal({
      threadId: state.data.threadId,
      category,
      mode: 'install',
      title: state.data.title,
      detail: state.data,
      // O download adiciona o jogo à biblioteca; reflete na hora no botão.
      onStarted: () => setJustAdded(true),
    });
  }

  /** F95 has a newer version than the installed one: download it. */
  function onUpdate() {
    if (state.kind !== 'ready') return;
    openGameDownloadModal({
      threadId: state.data.threadId,
      category,
      mode: 'update',
      title: state.data.title,
      versionLabel: state.data.version,
      detail: state.data,
    });
  }

  if (state.kind === 'loading') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo={storeHref}
          breadcrumbLabel={t('nav.store')}
        />
        <GameDetailLoading />
      </GameDetailShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo={storeHref}
          breadcrumbLabel={t('nav.store')}
        />
        <GameDetailError
          message={describeIpcError(state.error, t)}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </GameDetailShell>
    );
  }

  const g = state.data;
  const displayPrefixes = normalizeDetailPrefixes(g.prefixes, g.version);
  const libraryBadge = libraryBadgeKind(libraryEntry, g.version);
  const sanitized = sanitizeF95Html(g.descriptionHtml);
  const changelog = g.changelogHtml ? sanitizeF95Html(g.changelogHtml) : '';

  return (
    <GameDetailShell onContextMenu={openDetailContextMenu}>
      <GameDetailBackBar
        onBack={() => navigate(-1)}
        breadcrumbTo={storeHref}
        breadcrumbLabel={t('nav.store')}
      />

      <GameDetailHero
        bannerUrl={g.bannerUrl}
        coverUrl={g.bannerUrl}
        badges={
          <>
            {libraryBadge && libraryEntry && (
              <LibraryBadge
                kind={libraryBadge}
                entry={libraryEntry}
                storeVersion={g.version}
                inline
              />
            )}
            {displayPrefixes.map((p) => {
              const to = storeLinks.prefix(p.name);
              const pill = <PrefixPill name={p.name} cssClass={p.cssClass} />;
              return to ? (
                <Link
                  key={p.name}
                  to={to}
                  className="game-detail-prefix-link"
                  title={t('gamedetail.moreWith', { name: p.name })}
                >
                  {pill}
                </Link>
              ) : (
                <span key={p.name}>{pill}</span>
              );
            })}
          </>
        }
        title={g.title}
        meta={
          <HeroMeta
            detail={g}
            stats={cardStats}
            developerTo={g.developer ? storeLinks.developer(g.developer) : null}
          />
        }
        actions={
          <>
            {libraryBadge === 'update' ? (
              <>
                <GameDetailBtnPrimary
                  onClick={onUpdate}
                  className="game-detail-btn-update"
                  title={t('store.lib.updateTitle', {
                    installed: libraryEntry?.currentVersion ?? '?',
                    latest: g.version ?? '?',
                  })}
                >
                  <Icon name="download" size={15} strokeWidth={2.4} />
                  {g.version
                    ? t('libdetail.action.update', { version: g.version })
                    : t('gamedetail.action.update')}
                </GameDetailBtnPrimary>
                <GameDetailBtnSecondary onClick={() => navigate(`/library/game/${g.threadId}`)}>
                  <Icon name="library" size={15} />
                  {t('gamedetail.action.openInLibrary')}
                </GameDetailBtnSecondary>
              </>
            ) : inLibrary ? (
              <GameDetailBtnPrimary as="a" to={`/library/game/${g.threadId}`}>
                <Icon name="library" size={15} />
                {t('gamedetail.action.openInLibrary')}
              </GameDetailBtnPrimary>
            ) : (
              <div className="install-split">
                <button
                  type="button"
                  className="game-detail-btn game-detail-btn-primary install-split-btn install-split-main"
                  onClick={onInstall}
                  title={t('gamedetail.action.install.title')}
                >
                  <Icon name="download" size={15} strokeWidth={2.4} className="install-split-icon" />
                  <span className="install-split-label">
                    {t('gamedetail.action.install')}
                  </span>
                </button>
                <button
                  type="button"
                  className="game-detail-btn game-detail-btn-secondary install-split-btn install-split-add"
                  onClick={onAddToLibrary}
                  disabled={adding}
                  title={t('gamedetail.action.addToLibrary')}
                >
                  <Icon name="plus" size={15} strokeWidth={2.6} className="install-split-icon" />
                  <span className="install-split-label">
                    {adding
                      ? t('gamedetail.action.adding')
                      : t('gamedetail.action.addToLibrary')}
                  </span>
                </button>
              </div>
            )}
            <GameDetailBtnSecondary onClick={() => openUrl(g.threadUrl)}>
              <Icon name="external" size={15} />
              {t('gamedetail.action.openThread')}
            </GameDetailBtnSecondary>
          </>
        }
      />

      <GameDetailBody>
        <GameDetailMain>
          {g.screenshots.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.screenshots')}>
              <ScreenshotGallery images={g.screenshots} />
            </GameDetailSection>
          )}

          {g.tags.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.tags')}>
              <StoreTagList tags={g.tags} category={category} />
            </GameDetailSection>
          )}

          <GameDetailSection title={t('gamedetail.section.about')}>
            <div onClick={onContentClick}>
              <GameDescription
                html={sanitized}
                style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
              />
            </div>
          </GameDetailSection>

          {changelog && (
            <GameDetailSection title={t('gamedetail.section.changelog')}>
              <div onClick={onContentClick}>
                <CollapsibleHtml html={changelog} />
              </div>
            </GameDetailSection>
          )}

          {category === 'games' && <StoreAchievementsSection detail={g} />}
        </GameDetailMain>

        <GameDetailAside>
          <GameDetailSection title={t('gamedetail.section.info')}>
            <StoreInfoFields detail={g} category={category} />
          </GameDetailSection>

          <GameDetailSection title={t('dl.section')} className="game-detail-downloads">
            <DownloadLinks
              embedded
              game={{
                threadId: g.threadId,
                category,
                title: g.title,
                threadUrl: g.threadUrl,
                thumbnailUrl: g.bannerUrl,
                version: g.version,
              }}
              downloads={g.downloads}
              social={g.social}
            />
          </GameDetailSection>
        </GameDetailAside>
      </GameDetailBody>
    </GameDetailShell>
  );
}

/**
 * One row under the title: developer (opens their games in the store),
 * version, when the thread was updated, and the card's rating, likes and
 * views when the page was opened from the store list. Platform, release
 * date and the rest stay in the Information panel.
 */
function HeroMeta({
  detail,
  stats,
  developerTo,
}: {
  detail: GameDetail;
  stats: SamGameCard | null;
  developerTo: string | null;
}) {
  const { t, locale } = useT();
  const updated = detail.fields['Thread Updated']?.trim() ?? '';
  const updatedMs = /^\d{4}-\d{2}-\d{2}$/.test(updated)
    ? new Date(`${updated}T00:00:00`).getTime()
    : null;
  const ago = updatedMs ? formatAgo(updatedMs, locale) : null;
  return (
    <>
      {detail.developer &&
        (developerTo ? (
          <Link
            to={developerTo}
            className="game-detail-chip game-detail-chip-link"
            title={t('gamedetail.moreFrom', { name: detail.developer })}
          >
            {detail.developer}
          </Link>
        ) : (
          <GameDetailChip title={t('gamedetail.meta.developer')}>{detail.developer}</GameDetailChip>
        ))}
      {detail.version && (
        <GameDetailChip accent title={t('gamedetail.meta.version')}>
          {detail.version}
        </GameDetailChip>
      )}
      {updatedMs && (
        <GameDetailChip title={new Date(updatedMs).toLocaleDateString(locale)}>
          {ago
            ? t('gamedetail.meta.updatedAgo', { when: ago })
            : t('gamedetail.meta.updatedOn', { date: formatDay(updatedMs, locale) })}
        </GameDetailChip>
      )}
      {stats?.rating != null && stats.rating > 0 && (
        <GameDetailChip title={t('gamedetail.meta.rating')}>
          <Icon name="star" size={12} className="game-detail-chip-icon" />
          {stats.rating.toFixed(1)}
        </GameDetailChip>
      )}
      {stats?.likes != null && (
        <GameDetailChip title={t('gamedetail.meta.likes')}>
          <Icon name="heart" size={12} className="game-detail-chip-icon" />
          {formatCount(stats.likes)}
        </GameDetailChip>
      )}
      {stats?.views != null && (
        <GameDetailChip title={t('gamedetail.meta.views')}>
          <Icon name="eye" size={12} className="game-detail-chip-icon" />
          {formatCount(stats.views)}
        </GameDetailChip>
      )}
    </>
  );
}

function normalizeDetailPrefixes(
  prefixes: GamePrefix[],
  version: string | null,
): GamePrefix[] {
  const seen = new Set<string>();
  const out: GamePrefix[] = [];
  const versionKey = version?.trim().toLowerCase() ?? '';

  for (const p of prefixes) {
    const name = p.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (versionKey && key === versionKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
