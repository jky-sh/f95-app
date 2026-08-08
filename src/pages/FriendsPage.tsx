import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as ipc from '../lib/ipc';
import { useT } from '../lib/i18n';
import { FriendCardGridSkeleton } from '../components/ui/FriendCardSkeleton';
import { Spinner } from '../components/ui/Spinner';
import { OfflineGate } from '../components/OfflineGate';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { buildFriendsMenu } from '../lib/contextMenus/buildFriendsMenu';
import type { FollowedUser } from '../types/social';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; users: FollowedUser[] };

export function FriendsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { openContextMenu } = useContextMenu();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const users = await ipc.getFollowing();
      setState({ kind: 'ready', users });
    } catch (err) {
      setState({
        kind: 'error',
        message: err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : String(err),
      });
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const visible = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const sorted = [...state.users].sort((a, b) =>
      a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
    );
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((u) => u.username.toLowerCase().includes(q));
  }, [state, search]);

  return (
    <OfflineGate>
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{t('friends.title')}</h1>
          {state.kind === 'ready' && state.users.length > 0 && (
            <div style={subtitleStyle}>
              {t('friends.subtitle', { count: state.users.length })}
            </div>
          )}
        </div>
        <button
          onClick={reload}
          disabled={state.kind === 'loading'}
          style={refreshBtn}
        >
          {state.kind === 'loading' ? (
            <span style={refreshingLabelStyle}>
              <Spinner size="sm" />
              {t('common.loading')}
            </span>
          ) : (
            t('common.refresh')
          )}
        </button>
      </header>

      {state.kind === 'ready' && state.users.length > 0 && (
        <input
          type="text"
          value={search}
          placeholder={t('friends.searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInput}
        />
      )}

      {state.kind === 'error' && <div style={errorBox}>{state.message}</div>}

      {state.kind === 'loading' && <FriendCardGridSkeleton count={6} />}

      {state.kind === 'ready' && state.users.length === 0 && (
        <div style={emptyBox}>
          <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 14 }}>
            {t('friends.empty.title')}
          </p>
          <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>
            {t('friends.empty.hint')}
          </p>
        </div>
      )}

      {state.kind === 'ready' && state.users.length > 0 && (
        <div style={gridStyle}>
          {visible.map((u) => (
            <button
              key={u.userId}
              className="friend-card"
              onClick={() => navigate(`/friends/${u.userId}`)}
              onContextMenu={(e) =>
                openContextMenu(
                  e,
                  buildFriendsMenu(u, {
                    isOffline,
                    t,
                    onViewProfile: () => navigate(`/friends/${u.userId}`),
                  }),
                )
              }
              style={cardStyle}
              title={t('friends.viewProfile')}
            >
              <div style={avatarWrap}>
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt={u.username} style={avatarImg} />
                ) : (
                  <span style={avatarFallback}>
                    {u.username.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={usernameStyle} title={u.username}>{u.username}</div>
                {u.customTitle && (
                  <div style={customTitleStyle} title={u.customTitle}>
                    {u.customTitle}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
    </OfflineGate>
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
const subtitleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: 'var(--text-muted)',
};
const searchInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text-secondary)',
  fontSize: 13,
  outline: 'none',
  marginBottom: 14,
};
const refreshBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '5px 12px',
  borderRadius: 3,
  fontSize: 12,
  cursor: 'pointer',
};
const refreshingLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 10,
};
const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '10px 12px',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
};
const avatarWrap: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: '50%',
  background: 'var(--bg-sunken)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
};
const avatarImg: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};
const avatarFallback: React.CSSProperties = {
  fontSize: 18,
  color: 'var(--text-faint)',
  fontWeight: 700,
};
const usernameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const customTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginTop: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const emptyBox: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 16px',
  color: 'var(--text-muted)',
  fontSize: 13,
  background: 'var(--bg-elevated)',
  border: '1px dashed var(--border)',
  borderRadius: 4,
};
const errorBox: React.CSSProperties = {
  background: 'var(--status-danger-bg)',
  border: '1px solid var(--accent-strong)',
  color: 'var(--status-danger-text)',
  padding: '12px 16px',
  borderRadius: 4,
  marginBottom: 16,
  fontSize: 13,
};
