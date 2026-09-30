import { useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';
import { Icon } from './Icon';

/**
 * Search field for list pages: Esc clears it, the × button too, and with
 * `shortcut` Ctrl/⌘+F jumps to it from anywhere on the page.
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  shortcut = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  shortcut?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  return (
    <label className={className ? `ui-search ${className}` : 'ui-search'}>
      <Icon name="search" size={15} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
      />
      {value && (
        <button type="button" aria-label={t('common.clear')} title={t('common.clear')} onClick={() => onChange('')}>
          <Icon name="x" size={14} />
        </button>
      )}
    </label>
  );
}
