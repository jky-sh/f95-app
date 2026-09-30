import { useCallback, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Icon, type IconName } from './Icon';

/** How a list of games is laid out. */
export type ViewMode = 'covers' | 'cards' | 'list';

const MODES: { id: ViewMode; icon: IconName; labelKey: string }[] = [
  { id: 'covers', icon: 'covers', labelKey: 'view.covers' },
  { id: 'cards', icon: 'cards', labelKey: 'view.cards' },
  { id: 'list', icon: 'list', labelKey: 'view.list' },
];

function isViewMode(value: unknown): value is ViewMode {
  return value === 'covers' || value === 'cards' || value === 'list';
}

/**
 * The view mode a page was last left in, per page (`library`, `store`…).
 * Kept in localStorage: a per-window convenience that can fall back to the
 * default whenever storage is unavailable.
 */
export function useViewMode(page: string, fallback: ViewMode = 'cards'): [ViewMode, (mode: ViewMode) => void] {
  const key = `f95.view.${page}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(key);
      return isViewMode(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (next: ViewMode) => {
      setMode(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* still switches for this session */
      }
    },
    [key],
  );
  return [mode, update];
}

export function ViewModeSwitch({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  const { t } = useT();
  return (
    <div className="ui-segmented" role="group" aria-label={t('view.label')}>
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={value === m.id}
          aria-label={t(m.labelKey)}
          title={t(m.labelKey)}
          onClick={() => onChange(m.id)}
        >
          <Icon name={m.icon} size={15} />
        </button>
      ))}
    </div>
  );
}
