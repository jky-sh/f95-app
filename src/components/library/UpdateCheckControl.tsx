import { useEffect, useRef } from 'react';
import { useOffline } from '../../contexts/Offline';
import { useNow } from '../../hooks/useNow';
import { useT } from '../../lib/i18n';
import { formatWhen } from '../../lib/memberPresence';
import {
  cancelUpdateCheck,
  runUpdateCheck,
  useUpdateCheck,
} from '../../lib/updateChecker';

/**
 * "Check for updates" with the shared check's progress (and Cancel) while it
 * runs, then when it last finished and what it found. Library and News show
 * the same run.
 */
export function UpdateCheckControl({
  buttonStyle,
  onShowUpdates,
}: {
  buttonStyle?: React.CSSProperties;
  /** Offered next to "N updates found" (e.g. filter the library to them). */
  onShowUpdates?: () => void;
}) {
  const { t, locale } = useT();
  const { isOffline } = useOffline();
  const check = useUpdateCheck();
  const now = useNow();

  if (check.running) {
    const progress =
      check.phase === 'catalog'
        ? t('updates.progress.catalog', { done: check.done, total: check.total })
        : check.phase === 'threads'
          ? t('library.checking', { done: check.done, total: check.total })
          : t('updates.progress.starting');
    return (
      <div style={rowStyle}>
        <span style={statusStyle} aria-live="polite">
          {progress}
        </span>
        <button type="button" onClick={cancelUpdateCheck} style={buttonStyle}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  return (
    <div style={rowStyle}>
      <span style={statusStyle}>
        {check.interrupted
          ? t('updates.status.interrupted')
          : check.checkedAt
            ? t('updates.status.checked', { when: formatWhen(check.checkedAt, locale, now) })
            : null}
        {!check.interrupted && check.found > 0 && (
          <>
            {' · '}
            {onShowUpdates ? (
              <button type="button" onClick={onShowUpdates} style={linkStyle}>
                {t('updates.status.found', { count: check.found })}
              </button>
            ) : (
              t('updates.status.found', { count: check.found })
            )}
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => void runUpdateCheck()}
        disabled={isOffline}
        title={isOffline ? t('offline.actionBlocked') : undefined}
        style={{ ...buttonStyle, ...(isOffline ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
      >
        {t('library.checkUpdates')}
      </button>
    </div>
  );
}

/** How long after the last check a background one is worth running. */
const BACKGROUND_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const BACKGROUND_FIRST_DELAY_MS = 90_000;
const BACKGROUND_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Background update checks while the app is open and online: a while after
 * startup, then every few hours, only via SAM's latest list (cheap) and
 * only when the last check is older than two hours. Mounted once.
 */
export function UpdateCheckScheduler() {
  const { isOffline } = useOffline();
  const check = useUpdateCheck();
  const checkedAt = check.checkedAt;
  useEffect(() => {
    if (isOffline) return;
    const tick = () => {
      if (checkedAt && Date.now() - checkedAt < BACKGROUND_MIN_AGE_MS) return;
      void runUpdateCheck({ background: true });
    };
    const first = setTimeout(tick, BACKGROUND_FIRST_DELAY_MS);
    const every = setInterval(tick, BACKGROUND_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [isOffline, checkedAt]);
  return null;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const statusStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-faint)',
};

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  font: 'inherit',
  cursor: 'pointer',
};

/** Run `effect` when a check finishes (to reload what it changed). */
export function useAfterUpdateCheck(effect: () => void): void {
  const { running } = useUpdateCheck();
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) effect();
    wasRunning.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
}
