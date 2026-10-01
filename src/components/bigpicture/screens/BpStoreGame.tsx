import { useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useOffline } from '../../../contexts/Offline';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useLibraryIndex } from '../../../hooks/useLibraryIndex';
import { cachedGameDetail, loadGameDetail, storedGameDetail } from '../../../lib/gameDetailCache';
import { openGameDownloadModal } from '../../../lib/gameDownloadModal';
import { describeIpcError } from '../../../lib/ipcError';
import * as library from '../../../lib/library';
import { useT } from '../../../lib/i18n';
import type { GameDetail } from '../../../types/game';
import type { SamCategory, SamGameCard } from '../../../types/sam';
import { formatCount } from '../../store/GameCard';
import { ContentTagPills } from '../../store/ContentTagPills';
import { PrefixPills } from '../../store/PrefixPills';
import { Icon } from '../../ui/Icon';
import { useBp } from '../BpContext';
import { BpDownloadButton } from '../BpInstall';
import { BpEmpty, BpLoader, BpSubTabs, markWholeArt, useProgressiveArt } from '../BpParts';
import {
  BpFacts,
  BpReadingBlock,
  BpScreenshotGrid,
  BpTagList,
  changelogOf,
  overviewOf,
  useThreadFacts,
} from './BpGameParts';

type StoreTab = 'overview' | 'screenshots' | 'changelog';

/** Session copy first, then the one saved on disk, then F95 (online). */
function useDetail(threadId: string, isOffline: boolean) {
  const [detail, setDetail] = useState<GameDetail | null>(() => cachedGameDetail(threadId));
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const fresh = cachedGameDetail(threadId);
    setDetail(fresh);
    if (fresh) return;
    void storedGameDetail(threadId).then((stored) => {
      if (!cancelled && stored) setDetail((current) => current ?? stored);
    });
    if (!isOffline) {
      loadGameDetail(threadId)
        .then((loaded) => {
          if (!cancelled) setDetail(loaded);
        })
        .catch((err) => {
          if (!cancelled) setError(err);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [threadId, isOffline]);
  return { detail, error };
}

/** A store listing: read about it, then install or add it without leaving Big Picture. */
export function BpStoreGame({
  threadId,
  category,
  card,
}: {
  threadId: string;
  category: SamCategory;
  card?: SamGameCard;
}) {
  const { t } = useT();
  const bp = useBp();
  const { isOffline } = useOffline();
  const entry = useLibraryIndex().get(threadId);
  const download = useDownloadsByThread().get(threadId);
  const { detail, error } = useDetail(threadId, isOffline);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<StoreTab>('overview');

  const title = card?.title ?? detail?.title ?? null;
  const cover = card?.thumbnailUrl ?? detail?.bannerUrl ?? null;
  const version = card?.version ?? detail?.version ?? null;
  const creator = card?.creator ?? detail?.developer ?? null;
  const threadUrl = card?.threadUrl ?? detail?.threadUrl ?? `https://f95zone.to/threads/${threadId}/`;
  const rating = card?.rating || detail?.rating?.average || null;
  const art = useProgressiveArt(cover);
  const overview = useMemo(() => (detail ? overviewOf(detail.descriptionHtml) : []), [detail]);
  const changelog = useMemo(() => (detail?.changelogHtml ? changelogOf(detail.changelogHtml) : []), [detail]);
  const facts = useThreadFacts(detail);
  const shots = detail?.screenshots.length ? detail.screenshots : (card?.screens ?? []);

  useEffect(() => bp.setBackdrop(cover), [bp, cover]);

  if (!title) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        {error != null || isOffline ? (
          <BpEmpty
            icon="alert"
            title={t('bp.store.error')}
            text={isOffline ? t('bp.store.offline') : describeIpcError(error, t)}
            action={
              <button type="button" className="bp-btn bp-focusable" data-bp-autofocus="" onClick={bp.back}>
                {t('bp.hint.back')}
              </button>
            }
          />
        ) : (
          <BpLoader label={t('common.loading')} />
        )}
      </div>
    );
  }

  const menuGame = { threadId, title, threadUrl, thumbnailUrl: cover, version, creator };
  const installable =
    !download && (!entry || entry.installStatus === 'not_installed' || entry.installStatus === 'error');

  async function addToLibrary() {
    setAdding(true);
    try {
      await library.add({ threadId, category, title: title!, threadUrl, thumbnailUrl: cover, currentVersion: version });
    } finally {
      setAdding(false);
    }
  }

  const tabs: { id: StoreTab; label: string; count?: number | null }[] = [
    { id: 'overview', label: t('bp.game.tab.overview') },
    ...(shots.length ? [{ id: 'screenshots' as const, label: t('bp.game.screenshots'), count: shots.length }] : []),
    ...(changelog.length ? [{ id: 'changelog' as const, label: t('bp.game.tab.changelog') }] : []),
  ];
  const current = tabs.some((x) => x.id === tab) ? tab : 'overview';

  return (
    <div className="bp-screen-body bp-detail" data-bp-scroll-y="">
      <section className="bp-detail-hero" data-bp-snap="top">
        <div className="bp-game-art">
          {art && <img src={art} alt="" draggable={false} onLoad={markWholeArt} />}
        </div>
        <div className="bp-detail-head">
          <h1 className="bp-detail-title">{title}</h1>
          <div className="bp-meta">
            {entry && <span className="bp-badge bp-badge--info">{t('bp.store.inLibrary')}</span>}
            {creator && <span>{creator}</span>}
            {version && <span>{version}</span>}
            {rating ? (
              <span>
                <Icon name="star" size={15} /> {rating.toFixed(1)}
              </span>
            ) : null}
            {card?.likes != null && (
              <span>
                <Icon name="heart" size={15} /> {formatCount(card.likes)}
              </span>
            )}
            {card?.views != null && (
              <span>
                <Icon name="eye" size={15} /> {formatCount(card.views)}
              </span>
            )}
          </div>
          {card && (
            <div className="bp-detail-pills">
              <PrefixPills prefixIds={card.prefixIds} threadId={threadId} maxLeft={4} />
            </div>
          )}
          <div className="bp-actions" data-bp-group="store-actions" data-bp-row="">
            {download && <BpDownloadButton download={download} primary />}
            {installable && (
              <button
                type="button"
                className="bp-btn bp-btn--lg bp-btn--primary bp-focusable"
                data-bp-autofocus=""
                disabled={isOffline}
                onClick={() =>
                  openGameDownloadModal({ threadId, category, mode: 'install', title, detail: detail ?? undefined })
                }
              >
                <Icon name="download" size={22} />
                {t('bp.store.install')}
              </button>
            )}
            {entry ? (
              <button
                type="button"
                className={`bp-btn bp-focusable${installable || download ? '' : ' bp-btn--lg bp-btn--primary'}`}
                data-bp-autofocus={installable || download ? undefined : ''}
                onClick={() => bp.push({ screen: 'game', threadId })}
              >
                <Icon name="library" size={20} />
                {t('bp.store.openInLibrary')}
              </button>
            ) : (
              <button type="button" className="bp-btn bp-focusable" disabled={adding} onClick={() => void addToLibrary()}>
                <Icon name="plus" size={20} />
                {t('bp.store.addToLibrary')}
              </button>
            )}
            <button type="button" className="bp-btn bp-focusable" disabled={isOffline} onClick={() => void openUrl(threadUrl)}>
              <Icon name="external" size={20} />
              {t('bp.store.openThread')}
            </button>
            <button
              type="button"
              className="bp-btn bp-btn--icon bp-focusable"
              aria-label={t('bp.hint.options')}
              title={t('bp.hint.options')}
              data-bp-a={t('bp.hint.options')}
              onClick={() => bp.openStoreOptions(menuGame, category)}
            >
              <Icon name="more" size={24} strokeWidth={3} />
            </button>
          </div>
        </div>
      </section>

      <BpSubTabs id={`store-tabs-${threadId}`} tabs={tabs} active={current} onChange={setTab} />

      <div className="bp-panel" key={current}>
        {current === 'overview' && (
          <div className="bp-overview">
            {overview.length > 0 ? (
              <BpReadingBlock blocks={overview} />
            ) : detail ? (
              <p className="bp-muted">{t('bp.game.noDescription')}</p>
            ) : isOffline ? (
              <p className="bp-muted">{t('bp.store.offline')}</p>
            ) : (
              <BpLoader label={t('common.loading')} />
            )}
            <aside className="bp-overview-side">
              <BpFacts facts={facts} />
              {detail ? (
                <BpTagList tags={detail.tags.map((tag) => tag.name)} />
              ) : (
                card && <ContentTagPills tagIds={card.tagIds} max={14} />
              )}
            </aside>
          </div>
        )}
        {current === 'screenshots' && <BpScreenshotGrid images={shots} />}
        {current === 'changelog' && <BpReadingBlock blocks={changelog} className="bp-read--log" />}
      </div>
    </div>
  );
}
