import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useNotifications } from '../../../contexts/Notifications';
import { useOffline } from '../../../contexts/Offline';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useLibraryIndex } from '../../../hooks/useLibraryIndex';
import { useNow } from '../../../hooks/useNow';
import { useRssFeed } from '../../../hooks/useRssFeed';
import { alertInitial, cleanAlertText } from '../../../lib/alertText';
import { parseDbTime } from '../../../lib/dbTime';
import { formatRelativeDate, getDateGroup, sortDateGroups, type DateGroup } from '../../../lib/formatDate';
import { useT } from '../../../lib/i18n';
import * as ipc from '../../../lib/ipc';
import { describeIpcError } from '../../../lib/ipcError';
import { hasPendingUpdate } from '../../../lib/library';
import { installAppUpdate } from '../../../lib/appUpdater';
import { activityRoute } from '../../../lib/memberLinks';
import { formatWhen } from '../../../lib/memberPresence';
import { localSourceLabelKey } from '../../../lib/notificationLinks';
import { cancelUpdateCheck, runUpdateCheck, useUpdateCheck } from '../../../lib/updateChecker';
import type { ActivityItem } from '../../../types';
import type { LibraryGame } from '../../../types/library';
import type { RssFeedItem } from '../../../types/rss';
import type { SamGameCard } from '../../../types/sam';
import { libraryBadgeKind } from '../../store/LibraryBadge';
import { Icon } from '../../ui/Icon';
import { useBp, useBpGames, useBpProfile } from '../BpContext';
import { BpEmpty, BpGameTile, BpGrid, BpHeading, BpLoader, BpStoreTile, BpSubTabs } from '../BpParts';
import { BpActivityFeed } from './BpSocialParts';

export type NewsSection = 'feed' | 'updates' | 'alerts' | 'activity';
type FeedFilter = 'all' | 'new' | 'update' | 'library';

/* A link to a section (the alerts) can arrive before News was ever shown. */
let requestedSection: NewsSection | null = null;
const SECTION_EVENT = 'bp:news-section';

/** Show `section` when News is next on screen (the caller switches to the tab). */
export function showNewsSection(section: NewsSection): void {
  requestedSection = section;
  window.dispatchEvent(new Event(SECTION_EVENT));
}

function takeRequestedSection(): NewsSection | null {
  const section = requestedSection;
  requestedSection = null;
  return section;
}

const SECTIONS: NewsSection[] = ['feed', 'updates', 'alerts', 'activity'];

/** Local notifications about library games (the feed's updates, update checks). */

/** The feed's title still carries the version ("Game [v0.25]"); it shows on its own. */
function feedTitle(item: RssFeedItem): string {
  if (!item.version) return item.displayTitle;
  return item.displayTitle.replace(/\s*\[[^\]]*\]\s*$/, '') || item.displayTitle;
}

/** A feed entry as a store card, so it opens and offers what store tiles do. */
function feedCard(item: RssFeedItem): SamGameCard {
  const ts = item.pubDate ? Date.parse(item.pubDate) : NaN;
  return {
    threadId: item.threadId,
    title: feedTitle(item),
    version: item.version,
    thumbnailUrl: item.thumbnailUrl,
    screens: [],
    threadUrl: item.link,
    prefixIds: [],
    tagIds: [],
    rating: null,
    views: null,
    likes: null,
    updatedAt: item.pubDate,
    updatedTs: Number.isNaN(ts) ? null : ts,
    creator: item.creator,
    watched: false,
    ignored: false,
    // The feed's own New / Update badge takes its place.
    isNew: false,
  };
}

interface AlertRow {
  key: string;
  id: string;
  kind: 'f95' | 'local';
  text: string;
  unread: boolean;
  ts: number | null;
  image: string | null;
  /** F95 alerts show who did it (round), local ones a game's art. */
  avatar: boolean;
  source: string | null;
  detail: string | null;
  url: string | null;
  threadId: string | null;
  /** A new version of the app itself: opening it offers the install. */
  appUpdate: boolean;
}

/**
 * What's new: F95's latest updates, the library's pending updates, alerts
 * and notifications, and the player's own activity on the forum, one per
 * sub-tab under a header that refreshes and checks for updates.
 */
export function BpNews({ active }: { active: boolean }) {
  const { t, locale } = useT();
  const bp = useBp();
  const profile = useBpProfile();
  const games = useBpGames();
  const { isOffline } = useOffline();
  const downloads = useDownloadsByThread();
  const libraryIndex = useLibraryIndex();
  const notifications = useNotifications();
  const check = useUpdateCheck();
  const now = useNow();
  const rss = useRssFeed({ enabled: active && !isOffline });
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<NewsSection>(() => takeRequestedSection() ?? 'feed');
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [activity, setActivity] = useState<ActivityItem[]>(profile.activity);
  const [refreshing, setRefreshing] = useState(false);
  const [art, setArt] = useState<string | null>(null);
  /** Bumped when a section is asked for, to move the focus onto its tab. */
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const onRequest = () => {
      const section = takeRequestedSection();
      if (!section) return;
      setTab(section);
      setRequest((n) => n + 1);
    };
    window.addEventListener(SECTION_EVENT, onRequest);
    return () => window.removeEventListener(SECTION_EVENT, onRequest);
  }, []);

  // Coming back to the screen restores the control used last, which may be
  // another sub-tab (they switch on focus): the one asked for wins. Runs
  // when asked only (`tab` is the section set in the same update).
  useEffect(() => {
    if (request === 0) return;
    const tabs = rootRef.current?.querySelectorAll<HTMLElement>('.bp-subtab');
    tabs?.[SECTIONS.indexOf(tab)]?.focus({ preventScroll: true });
  }, [request]);

  /* --- feed ----------------------------------------------------------------- */

  const flags = useMemo(
    () => ({
      new: { label: t('news.rss.badge.new'), tone: 'new' as const },
      update: { label: t('news.rss.badge.update'), tone: 'info' as const },
    }),
    [t],
  );
  const feed = useMemo(() => rss.items.map((item) => ({ item, card: feedCard(item) })), [rss.items]);
  /** "Creator · 2 hours ago" (re-read every minute with `now`). */
  const feedSub = (item: RssFeedItem) =>
    [item.creator, formatRelativeDate(item.pubDate, locale)].filter(Boolean).join(' · ') || null;
  const feedCounts = useMemo(
    () => ({
      all: feed.length,
      new: feed.filter((e) => e.item.kind === 'new').length,
      update: feed.filter((e) => e.item.kind === 'update').length,
      library: feed.filter((e) => libraryIndex.has(e.item.threadId)).length,
    }),
    [feed, libraryIndex],
  );
  const shownFeed = useMemo(
    () =>
      feed.filter((e) =>
        filter === 'all' ? true : filter === 'library' ? libraryIndex.has(e.item.threadId) : e.item.kind === filter,
      ),
    [feed, filter, libraryIndex],
  );

  /* --- library updates -------------------------------------------------------- */

  const pending = useMemo(() => (games ?? []).filter(hasPendingUpdate), [games]);

  /* --- alerts ------------------------------------------------------------------- */

  const alerts = useMemo(() => {
    const rows: AlertRow[] = notifications.unified.map((u): AlertRow => {
      if (u.kind === 'f95') {
        const a = u.alert;
        const ts = a.date ? Date.parse(a.date) : NaN;
        return {
          key: `f95:${a.alertId}`,
          id: a.alertId,
          kind: 'f95',
          text: cleanAlertText(a.text),
          unread: a.isUnread,
          ts: Number.isNaN(ts) ? null : ts,
          image: a.avatarUrl,
          avatar: true,
          source: t('notifications.source.f95'),
          detail: null,
          url: a.url,
          threadId: null,
          appUpdate: false,
        };
      }
      const n = u.notification;
      return {
        key: `local:${n.id}`,
        id: n.id,
        kind: 'local',
        text: n.title,
        unread: !n.readAt,
        ts: parseDbTime(n.createdAt)?.getTime() ?? null,
        image: n.thumbnailUrl,
        avatar: false,
        source: t(localSourceLabelKey(n.source)),
        detail: n.body,
        url: n.url,
        threadId: n.threadId,
        appUpdate: n.source === 'app_update',
      };
    });
    rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const groups = new Map<DateGroup, AlertRow[]>();
    for (const row of rows) {
      const group = getDateGroup(row.ts != null ? new Date(row.ts).toISOString() : null);
      groups.set(group, [...(groups.get(group) ?? []), row]);
    }
    return [...groups.entries()].sort(([a], [b]) => sortDateGroups(a, b));
  }, [notifications.unified, t]);

  function openAlert(row: AlertRow) {
    // Marking an F95 alert lowers the unread count whatever its state.
    if (row.unread) void notifications.markRead(row.id, row.kind).catch(() => undefined);
    if (row.appUpdate) {
      // Same as the top bar's update button: confirm, then install.
      void installAppUpdate(t);
      return;
    }
    const navigate = bp.gameDeps().navigate;
    // In-app paths (store and library pages) open here; F95 links to a
    // thread or a member too, anything else in the browser.
    if (row.url?.startsWith('/')) {
      navigate(row.url);
      return;
    }
    const route = row.url ? activityRoute(row.url) : null;
    if (route) navigate(route);
    else if (row.threadId) navigate(`/store/game/${row.threadId}?cat=games`);
    else if (row.url && /^https?:\/\//i.test(row.url)) void openUrl(row.url);
  }

  /* --- header ------------------------------------------------------------------- */

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        rss.reload(),
        notifications.refresh().catch(() => undefined),
        ipc
          .getProfile()
          .then((fresh) => setActivity(fresh.activity))
          .catch((err) => console.warn('[big-picture] profile refresh failed', err)),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  const progress = check.running
    ? check.phase === 'catalog'
      ? t('updates.progress.catalog', { done: check.done, total: check.total })
      : check.phase === 'threads'
        ? t('library.checking', { done: check.done, total: check.total })
        : t('updates.progress.starting')
    : check.interrupted
      ? t('updates.status.interrupted')
      : check.checkedAt
        ? t('updates.status.checked', { when: formatWhen(check.checkedAt, locale, now) })
        : null;
  const found = !check.running && !check.interrupted && check.found > 0;

  /** Check for updates, or Cancel while a check runs (here, in the Library or in the background). */
  const checkButton = (inPanel: boolean) =>
    check.running ? (
      <button
        type="button"
        className={`bp-btn${inPanel ? '' : ' bp-btn--sm'} bp-focusable`}
        data-bp-autofocus={inPanel || undefined}
        onClick={cancelUpdateCheck}
      >
        <Icon name="x" size={inPanel ? 20 : 18} />
        {t('common.cancel')}
      </button>
    ) : (
      <button
        type="button"
        className={`bp-btn${inPanel ? ' bp-btn--primary' : ' bp-btn--sm'} bp-focusable`}
        data-bp-autofocus={inPanel || undefined}
        disabled={isOffline}
        title={isOffline ? t('offline.actionBlocked') : undefined}
        onClick={() => void runUpdateCheck()}
      >
        <Icon name="refresh" size={inPanel ? 20 : 18} />
        {t('library.checkUpdates')}
      </button>
    );

  /* --- backdrop ------------------------------------------------------------------ */

  const firstArt = tab === 'updates' ? (pending[0]?.thumbnailUrl ?? null) : (feed[0]?.item.thumbnailUrl ?? null);
  useEffect(() => {
    // Only the section on screen paints the art behind everything.
    if (!active) return;
    const target = art ?? firstArt;
    if (!target) return;
    const timer = window.setTimeout(() => bp.setBackdrop(target), 140);
    return () => window.clearTimeout(timer);
  }, [bp, active, art, firstArt]);

  const onFocusCard = useCallback((card: SamGameCard) => setArt(card.thumbnailUrl), []);
  const onFocusGame = useCallback((game: LibraryGame) => setArt(game.thumbnailUrl), []);

  /* --- render -------------------------------------------------------------------- */

  const tabs: { id: NewsSection; label: string; count?: number | null }[] = [
    { id: 'feed', label: t('bp.news.tab.feed'), count: feed.length || null },
    { id: 'updates', label: t('bp.news.tab.updates'), count: pending.length || null },
    { id: 'alerts', label: t('bp.news.tab.alerts'), count: notifications.unreadCount || null },
    { id: 'activity', label: t('bp.news.tab.activity') },
  ];

  const filters: { id: FeedFilter; label: string }[] = [
    { id: 'all', label: t('notifications.filter.all') },
    { id: 'new', label: t('news.rss.badge.new') },
    { id: 'update', label: t('bp.news.filter.updates') },
    { id: 'library', label: t('bp.store.inLibrary') },
  ];

  return (
    <div className="bp-screen-body bp-page bp-news" data-bp-scroll-y="" ref={rootRef}>
      <header className="bp-page-head" data-bp-snap="top">
        <div className="bp-page-head-text">
          <h1 className="bp-page-title">{t('news.title')}</h1>
          {(progress || found) && (
            <div className="bp-meta">
              {progress && <span>{progress}</span>}
              {found && <span className="bp-meta-accent">{t('updates.status.found', { count: check.found })}</span>}
            </div>
          )}
        </div>
        <div className="bp-page-tools" data-bp-group="news-actions" data-bp-row="">
          <button
            type="button"
            className="bp-btn bp-btn--sm bp-focusable"
            disabled={refreshing || isOffline}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={18} />
            {refreshing ? t('common.loading') : t('common.refresh')}
          </button>
          {checkButton(false)}
        </div>
      </header>

      <BpSubTabs id="news-tabs" tabs={tabs} active={tab} onChange={setTab} />

      <div className="bp-panel" key={tab}>
        {tab === 'feed' &&
          (isOffline && feed.length === 0 ? (
            <BpEmpty
              icon="alert"
              title={t('nav.offline')}
              text={t('news.rss.offline')}
              action={
                <button type="button" className="bp-btn bp-focusable" data-bp-autofocus="" onClick={() => setTab('updates')}>
                  {t('news.section.updates')}
                </button>
              }
            />
          ) : feed.length === 0 && rss.error != null ? (
            <BpEmpty
              icon="alert"
              title={t('bp.news.feedError')}
              text={describeIpcError(rss.error, t)}
              action={
                <button
                  type="button"
                  className="bp-btn bp-btn--primary bp-focusable"
                  data-bp-autofocus=""
                  onClick={() => void rss.reload()}
                >
                  {t('bp.store.retry')}
                </button>
              }
            />
          ) : feed.length === 0 ? (
            rss.loading ? (
              <div className="bp-center bp-center--pad">
                <BpLoader label={t('common.loading')} />
              </div>
            ) : (
              <BpEmpty icon="news" title={t('news.rss.empty')} />
            )
          ) : (
            <>
              <div className="bp-filter-line">
                <div className="bp-chip-row" data-bp-group="news-filter" data-bp-row="">
                  {filters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="bp-chip bp-focusable"
                      aria-pressed={f.id === filter}
                      onClick={() => setFilter(f.id)}
                    >
                      {f.label}
                      <span className="bp-chip-count">{feedCounts[f.id]}</span>
                    </button>
                  ))}
                </div>
                {rss.error != null && (
                  <span className="bp-muted">{t('news.loadFailed', { error: describeIpcError(rss.error, t) })}</span>
                )}
              </div>
              {shownFeed.length === 0 ? (
                <BpEmpty icon="news" title={t('bp.library.empty')} />
              ) : (
                <BpGrid key={filter}>
                  {shownFeed.map((e, i) => {
                    const entry = libraryIndex.get(e.item.threadId);
                    // A library game with the update already says "Update".
                    const said = e.item.kind === 'update' && libraryBadgeKind(entry, e.card.version) === 'update';
                    return (
                      <BpStoreTile
                        key={e.item.guid}
                        card={e.card}
                        category="games"
                        group="news-feed"
                        index={i}
                        autoFocus={i === 0}
                        entry={entry}
                        flag={said ? null : flags[e.item.kind]}
                        sub={feedSub(e.item)}
                        onFocusCard={onFocusCard}
                      />
                    );
                  })}
                </BpGrid>
              )}
            </>
          ))}

        {tab === 'updates' &&
          (!games ? (
            <div className="bp-center bp-center--pad">
              <BpLoader label={t('common.loading')} />
            </div>
          ) : pending.length === 0 ? (
            <BpEmpty icon="check" title={t('news.updates.empty')} action={checkButton(true)} />
          ) : (
            <BpGrid>
              {pending.map((g, i) => (
                <BpGameTile
                  key={g.threadId}
                  game={g}
                  group="news-updates"
                  index={i}
                  autoFocus={i === 0}
                  download={downloads.get(g.threadId)}
                  sub={
                    g.currentVersion
                      ? t('news.updateLabel', { from: g.currentVersion, to: g.availableVersion ?? '?' })
                      : t('news.updateLabelNew', { version: g.availableVersion ?? '?' })
                  }
                  onFocusGame={onFocusGame}
                />
              ))}
            </BpGrid>
          ))}

        {tab === 'alerts' && (
          <>
            <div className="bp-page-tools bp-news-alerts-tools" data-bp-group="news-alerts-actions" data-bp-row="">
              <button
                type="button"
                className="bp-btn bp-btn--sm bp-focusable"
                disabled={notifications.unreadCount === 0}
                onClick={() => void notifications.markAllRead().catch(() => undefined)}
              >
                <Icon name="check" size={18} />
                {t('notifications.markAllRead')}
              </button>
              <span className="bp-muted">
                {notifications.unreadCount > 0
                  ? t('notifications.unreadCount', { count: notifications.unreadCount })
                  : isOffline
                    ? t('notifications.offlineF95')
                    : null}
              </span>
            </div>
            {alerts.length === 0 ? (
              <BpEmpty icon="bell" title={t('notifications.empty')} />
            ) : (
              alerts.map(([group, rows], gi) => (
                <section key={group}>
                  <BpHeading title={t(`notifications.group.${group}`)} count={rows.length} />
                  <div className="bp-alerts">
                    {rows.map((row, i) => (
                      <button
                        key={row.key}
                        type="button"
                        className={`bp-alert bp-focusable${row.unread ? ' is-unread' : ''}`}
                        data-bp-a={t('bp.hint.open')}
                        data-bp-autofocus={(gi === 0 && i === 0) || undefined}
                        onClick={() => openAlert(row)}
                      >
                        <span className={`bp-alert-media${row.avatar ? ' bp-alert-media--round' : ''}`}>
                          {row.image ? <img src={row.image} alt="" loading="lazy" /> : alertInitial(row.text)}
                        </span>
                        <span className="bp-alert-body">
                          <span className="bp-alert-text">{row.text}</span>
                          <span className="bp-alert-meta">
                            {row.source && <span className="bp-alert-source">{row.source}</span>}
                            {row.detail && <span>{row.detail}</span>}
                            {row.ts != null && <span>{formatWhen(row.ts, locale, now)}</span>}
                          </span>
                        </span>
                        {row.unread && <span className="bp-alert-dot" aria-hidden />}
                      </button>
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}

        {tab === 'activity' &&
          (activity.length === 0 ? (
            <BpEmpty icon="news" title={t('news.activity.empty')} />
          ) : (
            <div className="bp-news-activity">
              <BpActivityFeed items={activity} now={now} />
            </div>
          ))}
      </div>
    </div>
  );
}
