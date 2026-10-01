import { useNow } from '../../hooks/useNow';

/** "4:05" / "1:02:03" since `since` (ms), ticking every second. */
export function PlayTimer({ since }: { since: number }) {
  const now = useNow(1000);
  return <>{formatElapsed(Math.max(0, now - since))}</>;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
