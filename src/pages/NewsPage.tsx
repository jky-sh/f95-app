import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import * as library from '../lib/library';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { buildNewsActivityMenu } from '../lib/contextMenus/buildNewsMenu';
import { useT } from '../lib/i18n';
import { RssFeedSection } from '../components/news/RssFeedSection';
import { NewsPageSkeleton } from '../components/ui/NewsPageSkeleton';
import { Spinner } from '../components/ui/Spinner';
import {
  UpdateCheckControl,
  useAfterUpdateCheck,
} from '../components/library/UpdateCheckControl';
import type { LibraryGame } from '../types/library';
import type { ActivityItem, ProfileDto } from '../types';

interface State {
  loading: boolean;
  error: string | null;
  updateGames: LibraryGame[];
  recentLibrary: LibraryGame[];
  activity: ActivityItem[];
  username: string | null;
}

export function NewsPage() {
  const { t } = useT();
  const location = useLocation();
  const { isOffline } = useOffline();
  const { openContextMenu } = useContextMenu();
  const [state, setState] = useState<State>({
    loading: true,
    error: null,
    updateGames: [],
    recentLibrary: [],
    activity: [],
    username: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async (forceRefetchProfile = false) => {
    setRefreshing(forceRefetchProfile);
    try {
      const [updateGames, games] = await Promise.all([
        library.listPendingUpdates({ sort: 'added' }),
        library.list({ sort: 'added' }),
      ]);
      const recentLibrary = games.slice(0, 8);

      let activity: ActivityItem[] = [];
      let username: string | null = null;
      try {
        // get_profile is fresh each time — no local cache, the sidecar
        // re-scrapes member page. Cheap enough for an explicit refresh.
        const profile: ProfileDto = await ipc.getProfile();
        activity = profile.activity ?? [];
        username = profile.username ?? null;
      } catch (err) {
        // Profile may fail in dev (sidecar restart wipes session). News still
        // works with just library data.
        console.warn('[news] profile fetch failed', err);
      }

      setState({
        loading: false,
        error: null,
        updateGames,
        recentLibrary,
        activity,
        username,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : String(err),
      }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (location.pathname !== '/news') return;
    void reload();
  }, [location.pathname, reload]);

  // A check (here, in the Library or in the background) changes this list.
  useAfterUpdateCheck(() => void reload());

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{t('news.title')}</h1>
        </div>
        <button
          onClick={() => reload(true)}
          disabled={refreshing}
          style={{ ...refreshBtn, ...(refreshing ? disabledBtn : {}) }}
        >
          {refreshing ? (
            <span style={refreshingLabelStyle}>
              <Spinner size="sm" />
              {t('common.loading')}
            </span>
          ) : (
            t('common.refresh')
          )}
        </button>
      </header>

      {isOffline && (
        <div className="offline-banner" role="status">
          {t('offline.newsBanner')}
        </div>
      )}

      {state.error && <div style={errorBox}>{state.error}</div>}

      {state.loading ? (
        <NewsPageSkeleton />
      ) : (
        <>
          <section className="news-section-rss">
            <h2 className="news-section-rss-title">{t('news.section.rss')}</h2>
            <RssFeedSection />
          </section>

          <section style={sectionStyle}>
            <div style={sectionHeadRow}>
              <h2 style={sectionTitleInline}>{t('news.section.updates')}</h2>
              <UpdateCheckControl buttonStyle={sectionActionBtn} />
            </div>
            {state.updateGames.length === 0 ? (
              <div style={hint}>{t('news.updates.empty')}</div>
            ) : (
              <ul style={listReset}>
                {state.updateGames.map((g) => (
                  <li key={g.threadId} style={updateRow}>
                    <Link to={`/library/game/${g.threadId}`} style={updateLink}>
                      {g.thumbnailUrl ? (
                        <img src={g.thumbnailUrl} alt="" style={updateThumb} />
                      ) : (
                        <div style={updateThumbFallback}>{g.title.slice(0, 1).toUpperCase()}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={updateTitle}>{g.title}</div>
                        <div style={updateMeta}>
                          {g.currentVersion
                            ? t('news.updateLabel', {
                                from: g.currentVersion,
                                to: g.availableVersion ?? '?',
                              })
                            : t('news.updateLabelNew', { version: g.availableVersion ?? '?' })}
                        </div>
                      </div>
                      <span style={updateBadge}>
                        {g.availableVersion ?? t('libcard.cta.update')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>{t('news.section.activity')}</h2>
            {state.activity.length === 0 ? (
              <div style={hint}>{t('news.activity.empty')}</div>
            ) : (
              <ul style={listReset}>
                {state.activity.slice(0, 12).map((a, i) => (
                  <li
                    key={i}
                    style={activityRow}
                    onContextMenu={
                      a.url
                        ? (e) =>
                            openContextMenu(
                              e,
                              buildNewsActivityMenu(a.url, { isOffline, t }),
                            )
                        : undefined
                    }
                  >
                    {a.avatarUrl && (
                      <img src={a.avatarUrl} alt="" style={activityAvatar} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={activityTitle}>
                        {a.url ? (
                          <a
                            href={a.url}
                            onClick={(e) => {
                              e.preventDefault();
                              if (a.url) openUrl(a.url);
                            }}
                            style={linkStyle}
                          >
                            {a.title}
                          </a>
                        ) : (
                          a.title
                        )}
                      </div>
                      {a.snippet && <div style={activitySnippet}>{a.snippet}</div>}
                    </div>
                    {a.date && <span style={activityDate}>{a.date}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {state.recentLibrary.length > 0 && (
            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>{t('news.section.recent')}</h2>
              <div style={recentGrid}>
                {state.recentLibrary.map((g) => (
                  <Link
                    key={g.threadId}
                    to={`/library/game/${g.threadId}`}
                    style={recentCard}
                  >
                    {g.thumbnailUrl && (
                      <img src={g.thumbnailUrl} alt="" style={recentThumb} />
                    )}
                    <div style={recentName} title={g.title}>{g.title}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = { padding: '20px 24px 40px' };
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-faint)',
  marginBottom: 16,
};
const titleStyle: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 };
const refreshBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
};
const disabledBtn: React.CSSProperties = { opacity: 0.55, cursor: 'wait' };
const refreshingLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
const sectionStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '14px 16px',
  marginBottom: 18,
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  margin: '0 0 10px',
};
const sectionHeadRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 10,
};
const sectionTitleInline: React.CSSProperties = {
  ...sectionTitleStyle,
  margin: 0,
};
const sectionActionBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--border-strong)',
  padding: '5px 12px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
};
const listReset: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const updateRow: React.CSSProperties = {};
const updateLink: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  background: 'var(--bg-sunken)',
  borderRadius: 3,
  color: 'var(--text-secondary)',
  textDecoration: 'none',
};
const updateThumb: React.CSSProperties = {
  width: 64,
  height: 36,
  objectFit: 'cover',
  borderRadius: 2,
  flexShrink: 0,
};
const updateThumbFallback: React.CSSProperties = {
  width: 64,
  height: 36,
  borderRadius: 2,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-hover)',
  color: 'var(--text-faint)',
  fontSize: 16,
  fontWeight: 800,
};
const updateTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const updateMeta: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const updateBadge: React.CSSProperties = {
  background: 'var(--status-info)',
  color: 'var(--text-primary)',
  padding: '3px 10px',
  borderRadius: 2,
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
};
const activityRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '8px 10px',
  background: 'var(--bg-sunken)',
  borderRadius: 3,
  alignItems: 'flex-start',
};
const activityAvatar: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  flexShrink: 0,
};
const activityTitle: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)' };
const activitySnippet: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 };
const activityDate: React.CSSProperties = { fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 };
const recentGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 10,
};
const recentCard: React.CSSProperties = {
  background: 'var(--bg-sunken)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  textDecoration: 'none',
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};
const recentThumb: React.CSSProperties = {
  width: '100%',
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  display: 'block',
};
const recentName: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const linkStyle: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none' };
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const errorBox: React.CSSProperties = {
  background: 'var(--status-danger-bg)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--status-danger-text)',
  padding: '12px 16px',
  borderRadius: 4,
  marginBottom: 16,
  fontSize: 13,
};
