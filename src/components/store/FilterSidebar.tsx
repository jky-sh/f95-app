import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SAM_CATEGORIES } from '../../constants/samCategories';
import * as ipc from '../../lib/ipc';
import { loadSamOptions } from '../../lib/samOptionsCache';
import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { useT } from '../../lib/i18n';
import { Spinner } from '../ui/Spinner';
import { loadStoredPrefixGroups } from '../../lib/prefixCatalogStorage';
import { fallbackPrefixGroupsForCategory } from '../../lib/fallbackPrefixGroups';
import {
  clampFloatingMenuStyle,
  computeFloatingMenuStyle,
  floatingMenuStyleKey,
} from '../../lib/floatingMenuPosition';
import {
  SAM_DATE_RANGES,
  type PrefixFilterMode,
  type SamCategory,
  type SamPrefixGroup,
  type SamTag,
  type SamTagMode,
} from '../../types/sam';
import type { TFunction } from '../../lib/i18n';

/** What the search box looks up: thread titles or developer names. */
export type StoreSearchMode = 'title' | 'creator';

const MAX_TAGS = 10;

function resolvePrefixGroups(fromApi: SamPrefixGroup[], category: SamCategory): SamPrefixGroup[] {
  if (fromApi.length > 0) return fromApi;
  const stored = loadStoredPrefixGroups();
  if (stored.length > 0) return stored;
  return fallbackPrefixGroupsForCategory(category);
}

interface Props {
  category: SamCategory;
  onCategory: (c: SamCategory) => void;
  search: string;
  onSearch: (s: string) => void;
  searchMode: StoreSearchMode;
  onSearchMode: (mode: StoreSearchMode) => void;
  /** Updated within this many days; 0 = any time. */
  date: number;
  onDate: (days: number) => void;
  prefixFilter: Record<number, PrefixFilterMode>;
  onPrefixFilter: (next: Record<number, PrefixFilterMode>) => void;
  selectedTags: SamTag[];
  excludedTags: SamTag[];
  onTags: (included: SamTag[], excluded: SamTag[]) => void;
  tagMode: SamTagMode;
  onTagMode: (mode: SamTagMode) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
}


export function FilterSidebar(props: Props) {
  const { t } = useT();
  const {
    category,
    onCategory,
    search,
    onSearch,
    searchMode,
    onSearchMode,
    date,
    onDate,
    prefixFilter,
    onPrefixFilter,
    selectedTags,
    excludedTags,
    onTags,
    tagMode,
    onTagMode,
    onClearAll,
    hasActiveFilters,
  } = props;

  const { setFromGroups } = usePrefixCatalog();
  const { setFromRecord: setTagCatalog } = useTagCatalog();
  const [prefixGroups, setPrefixGroups] = useState<SamPrefixGroup[]>(() =>
    resolvePrefixGroups([], category),
  );
  const [prefixLoading, setPrefixLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPrefixLoading(true);
    loadSamOptions(category)
      .then((result) => {
        if (cancelled) return;
        const next = resolvePrefixGroups(result.prefixGroups, category);
        setPrefixGroups(next);
        if (next.length > 0) setFromGroups(next);
        setTagCatalog(result.tagCatalog);
      })
      .catch((err) => {
        console.warn('[filter] samOptions failed, using fallback', err);
        if (!cancelled) {
          const next = resolvePrefixGroups([], category);
          setPrefixGroups(next);
          if (next.length > 0) setFromGroups(next);
        }
      })
      .finally(() => {
        if (!cancelled) setPrefixLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, setFromGroups, setTagCatalog]);

  const setPrefixMode = useCallback(
    (id: number, mode: PrefixFilterMode) => {
      const next = { ...prefixFilter };
      if (mode === null) {
        delete next[id];
      } else {
        next[id] = mode;
      }
      onPrefixFilter(next);
    },
    [prefixFilter, onPrefixFilter],
  );

  return (
    <aside className="store-filter">
      <div className="store-filter-head">
        <span className="store-filter-head-title">{t('filter.sidebar')}</span>
        {hasActiveFilters && (
          <button type="button" className="store-filter-clear" onClick={onClearAll}>
            {t('filter.clearAll')}
          </button>
        )}
      </div>

      <FilterSection title={t('filter.search')}>
        <div className="store-filter-search-wrap">
          <span className="store-filter-search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="store-filter-search"
            value={search}
            placeholder={
              searchMode === 'creator' ? t('filter.searchMode.creatorPlaceholder') : t('filter.search')
            }
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <div className="store-filter-tag-mode store-filter-search-mode">
          <span className="store-filter-tag-mode-label">{t('filter.searchMode')}</span>
          <div className="store-filter-tag-mode-toggle" role="group">
            <button
              type="button"
              className={searchMode === 'title' ? 'store-filter-tag-mode-active' : ''}
              aria-pressed={searchMode === 'title'}
              onClick={() => onSearchMode('title')}
            >
              {t('filter.searchMode.title')}
            </button>
            <span className="store-filter-tag-mode-sep">/</span>
            <button
              type="button"
              className={searchMode === 'creator' ? 'store-filter-tag-mode-active' : ''}
              aria-pressed={searchMode === 'creator'}
              onClick={() => onSearchMode('creator')}
            >
              {t('filter.searchMode.creator')}
            </button>
          </div>
        </div>
      </FilterSection>

      <FilterSection title={t('filter.section.category')}>
        <div className="store-filter-categories">
          {SAM_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`store-filter-cat${category === c.id ? ' store-filter-cat-active' : ''}`}
              onClick={() => onCategory(c.id)}
            >
              {c.literal ?? t(c.labelKey)}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title={t('filter.section.updated')}>
        <div className="store-filter-select-wrap">
          <select
            className="store-filter-select"
            value={date}
            onChange={(e) => onDate(Number(e.target.value))}
          >
            {SAM_DATE_RANGES.map((days) => (
              <option key={days} value={days}>
                {dateRangeLabel(days, t)}
              </option>
            ))}
          </select>
        </div>
      </FilterSection>

      <FilterSection title={t('filter.prefixes')}>
        <div key={category} className="store-filter-prefixes-wrap">
          {prefixLoading && prefixGroups.length === 0 && (
            <p className="store-filter-loading">
              <Spinner size="sm" /> {t('filter.prefixesLoading')}
            </p>
          )}
          {!prefixLoading && prefixGroups.length === 0 && (
            <p className="store-filter-prefixes-empty">{t('filter.prefixesEmpty')}</p>
          )}
          {prefixGroups.map((group) => (
            <PrefixGroupSection
              key={`${category}-${group.id}`}
              group={group}
              prefixFilter={prefixFilter}
              onSetMode={setPrefixMode}
            />
          ))}
        </div>
      </FilterSection>

      <FilterSection
        className="store-filter-section--tags"
        title={t('filter.tags.title')}
        hint={t('filter.tags.hint', { max: MAX_TAGS })}
      >
        <div className="store-filter-tag-mode">
          <span className="store-filter-tag-mode-label">{t('filter.tags.mode')}</span>
          <div className="store-filter-tag-mode-toggle" role="group">
            <button
              type="button"
              className={tagMode === 'or' ? 'store-filter-tag-mode-active' : ''}
              onClick={() => onTagMode('or')}
            >
              {t('filter.tags.or')}
            </button>
            <span className="store-filter-tag-mode-sep">/</span>
            <button
              type="button"
              className={tagMode === 'and' ? 'store-filter-tag-mode-active' : ''}
              onClick={() => onTagMode('and')}
            >
              {t('filter.tags.and')}
            </button>
          </div>
        </div>
        <TagFilterInput
          key={category}
          category={category}
          selected={selectedTags}
          excluded={excludedTags}
          onChange={onTags}
          max={MAX_TAGS}
        />
      </FilterSection>
    </aside>
  );
}

export function dateRangeLabel(days: number, t: TFunction): string {
  if (days === 0) return t('filter.updated.any');
  if (days === 1) return t('filter.updated.today');
  return t('filter.updated.days', { n: days });
}

function FilterSection({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className ? `store-filter-section ${className}` : 'store-filter-section'}>
      <h3 className="store-filter-section-title">{title}</h3>
      {hint && <p className="store-filter-section-hint">{hint}</p>}
      {children}
    </section>
  );
}

function PrefixGroupSection({
  group,
  prefixFilter,
  onSetMode,
}: {
  group: SamPrefixGroup;
  prefixFilter: Record<number, PrefixFilterMode>;
  onSetMode: (id: number, mode: PrefixFilterMode) => void;
}) {
  const { t } = useT();
  const title = group.name.toUpperCase();
  const activeCount = group.prefixes.filter((p) => prefixFilter[p.id]).length;

  return (
    <details className="store-filter-prefix-group">
      <summary className="store-filter-prefix-summary">
        <span className="store-filter-prefix-summary-title">
          {t('filter.prefix.groupLabel', { name: title })}
        </span>
        <span className="store-filter-prefix-summary-end">
          {activeCount > 0 && (
            <span className="store-filter-prefix-badge">{activeCount}</span>
          )}
          <span className="store-filter-prefix-chevron" aria-hidden />
        </span>
      </summary>
      <div className="store-filter-prefix-body">
        <ul className="store-filter-prefix-list">
          <li className="store-filter-prefix-row store-filter-prefix-row-head" aria-hidden>
            <span className="store-filter-prefix-name" />
            <span className="store-filter-prefix-col-label" title={t('filter.prefix.include')}>
              ✓
            </span>
            <span className="store-filter-prefix-col-label" title={t('filter.prefix.exclude')}>
              ✕
            </span>
          </li>
          {group.prefixes.map((p) => {
            const mode = prefixFilter[p.id] ?? null;
            return (
              <li key={p.id} className="store-filter-prefix-row">
                <span className="store-filter-prefix-name" title={p.name}>
                  {p.name}
                </span>
                <button
                  type="button"
                  className={`store-filter-prefix-btn store-filter-prefix-include${
                    mode === 'include' ? ' store-filter-prefix-btn-active' : ''
                  }`}
                  title={t('filter.prefix.include')}
                  aria-label={`${t('filter.prefix.include')}: ${p.name}`}
                  aria-pressed={mode === 'include'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetMode(p.id, mode === 'include' ? null : 'include');
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className={`store-filter-prefix-btn store-filter-prefix-exclude${
                    mode === 'exclude' ? ' store-filter-prefix-btn-active' : ''
                  }`}
                  title={t('filter.prefix.exclude')}
                  aria-label={`${t('filter.prefix.exclude')}: ${p.name}`}
                  aria-pressed={mode === 'exclude'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetMode(p.id, mode === 'exclude' ? null : 'exclude');
                  }}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

function TagFilterInput({
  category,
  selected,
  excluded,
  onChange,
  max,
}: {
  category: SamCategory;
  selected: SamTag[];
  /** Tags the results must not have (SAM `notags`). */
  excluded: SamTag[];
  onChange: (included: SamTag[], excluded: SamTag[]) => void;
  max: number;
}) {
  const { t } = useT();
  const { catalog, setFromRecord } = useTagCatalog();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SamTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const menuStyleKeyRef = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const menuResizeObserverRef = useRef<ResizeObserver | null>(null);

  // Suggestions skip tags already chosen either way.
  const selectedIds = useMemo(
    () => new Set([...selected, ...excluded].map((t) => t.id)),
    [selected, excluded],
  );
  const chosenCount = selected.length + excluded.length;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const buildLocalSuggestions = useCallback((qRaw: string, selectedSet: Set<number>) => {
    const q = qRaw.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const scored: { tag: SamTag; score: number }[] = [];

    for (const [id, name] of catalogRef.current) {
      if (selectedSet.has(id)) continue;
      const lower = name.toLowerCase();
      let score = 0;
      if (!q) {
        score = 1;
      } else if (lower === q) {
        score = 100;
      } else if (lower.startsWith(q)) {
        score = 80;
      } else if (lower.includes(q)) {
        score = 50;
      } else if (tokens.length > 0 && tokens.every((t) => lower.includes(t))) {
        score = 40;
      } else {
        continue;
      }
      scored.push({ tag: { id, name }, score });
    }

    scored.sort((a, b) => b.score - a.score || a.tag.name.localeCompare(b.tag.name));
    return scored.slice(0, q ? 24 : 20).map((s) => s.tag);
  }, []);

  // Keep the open dropdown in sync with the local catalog without re-fetching.
  useEffect(() => {
    if (!open) return;
    setSuggestions((prev) => {
      const local = buildLocalSuggestions(query, selectedIds);
      if (prev.length === 0) return local;
      const merged = new Map<number, SamTag>();
      for (const tag of prev) {
        if (!selectedIds.has(tag.id)) merged.set(tag.id, tag);
      }
      for (const tag of local) {
        if (!merged.has(tag.id)) merged.set(tag.id, tag);
      }
      return [...merged.values()].slice(0, 40);
    });
  }, [catalog, open, query, selectedIds, buildLocalSuggestions]);

  useEffect(() => {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setLoading(false);
  }, [category]);

  useEffect(() => {
    if (!open) return;

    const local = buildLocalSuggestions(query, selectedIdsRef.current);
    setSuggestions(local);

    let cancelled = false;
    const tmr = setTimeout(() => {
      // Only show the loading row when we have nothing useful yet.
      if (local.length === 0) setLoading(true);
      ipc
        .samTagSearch(category, query)
        .then((rows) => {
          if (cancelled) return;
          if (rows.length > 0) {
            const record: Record<string, string> = {};
            for (const tag of rows) record[String(tag.id)] = tag.name;
            setFromRecord(record);
          }
          const selectedSet = selectedIdsRef.current;
          const localNow = buildLocalSuggestions(query, selectedSet);
          const merged = new Map<number, SamTag>();
          for (const tag of rows) {
            if (!selectedSet.has(tag.id)) merged.set(tag.id, tag);
          }
          for (const tag of localNow) {
            if (!merged.has(tag.id)) merged.set(tag.id, tag);
          }
          setSuggestions([...merged.values()].slice(0, 40));
        })
        .catch((err) => {
          console.warn('[filter] tag search failed', err);
          if (!cancelled) {
            setSuggestions(buildLocalSuggestions(query, selectedIdsRef.current));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(tmr);
    };
    // Intentionally omit catalog: remote fetch only depends on query/open/category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query, open, buildLocalSuggestions, setFromRecord]);

  const updateMenuPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const menuH = menuRef.current?.offsetHeight ?? 0;
    let style = computeFloatingMenuStyle(input, menuH);
    if (menuRef.current) {
      style = clampFloatingMenuStyle(style, menuRef.current, input);
    }
    const key = floatingMenuStyleKey(style);
    if (menuStyleKeyRef.current === key) return;
    menuStyleKeyRef.current = key;
    setMenuStyle(style);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      menuStyleKeyRef.current = null;
      setMenuStyle(null);
      return;
    }

    updateMenuPosition();
    const raf = requestAnimationFrame(updateMenuPosition);

    const scrollRoot = inputRef.current?.closest('.store-filter');
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    scrollRoot?.addEventListener('scroll', updateMenuPosition);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
      scrollRoot?.removeEventListener('scroll', updateMenuPosition);
      menuResizeObserverRef.current?.disconnect();
      menuResizeObserverRef.current = null;
    };
  }, [open, query, suggestions.length, loading, updateMenuPosition]);

  const bindMenuRef = useCallback(
    (node: HTMLUListElement | null) => {
      menuResizeObserverRef.current?.disconnect();
      menuResizeObserverRef.current = null;
      menuRef.current = node;
      if (!node || !open) return;
      updateMenuPosition();
      menuResizeObserverRef.current = new ResizeObserver(updateMenuPosition);
      menuResizeObserverRef.current.observe(node);
    },
    [open, updateMenuPosition],
  );

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function addTag(tag: SamTag) {
    if (chosenCount >= max || selectedIds.has(tag.id)) return;
    onChange([...selected, tag], excluded);
    setQuery('');
    setOpen(false);
  }

  function removeTag(id: number) {
    onChange(
      selected.filter((t) => t.id !== id),
      excluded.filter((t) => t.id !== id),
    );
  }

  /** Include ⇄ exclude. */
  function toggleTag(tag: SamTag) {
    if (excluded.some((t) => t.id === tag.id)) {
      onChange(
        [...selected, tag],
        excluded.filter((t) => t.id !== tag.id),
      );
    } else {
      onChange(
        selected.filter((t) => t.id !== tag.id),
        [...excluded, tag],
      );
    }
  }

  const chip = (tag: SamTag, isExcluded: boolean) => (
    <span
      key={tag.id}
      className={`store-filter-tag-chip${isExcluded ? ' store-filter-tag-chip--exclude' : ''}`}
    >
      <button
        type="button"
        className="store-filter-tag-chip-toggle"
        aria-pressed={isExcluded}
        title={
          isExcluded
            ? t('filter.tags.include', { name: tag.name })
            : t('filter.tags.exclude', { name: tag.name })
        }
        onClick={() => toggleTag(tag)}
      >
        {isExcluded && <span aria-hidden>− </span>}
        {tag.name}
      </button>
      <button
        type="button"
        className="store-filter-tag-chip-remove"
        aria-label={t('filter.tags.remove', { name: tag.name })}
        onClick={() => removeTag(tag.id)}
      >
        ×
      </button>
    </span>
  );

  return (
    <div className="store-filter-tags" ref={wrapRef}>
      {chosenCount > 0 && (
        <>
          <div className="store-filter-tag-chips">
            {selected.map((tag) => chip(tag, false))}
            {excluded.map((tag) => chip(tag, true))}
          </div>
          <p className="store-filter-tag-chips-hint">{t('filter.tags.excludeHint')}</p>
        </>
      )}
      <div className="store-filter-tag-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="store-filter-tag-input"
          value={query}
          disabled={chosenCount >= max}
          placeholder={
            chosenCount >= max
              ? t('filter.tags.maxReached', { max })
              : t('filter.tags.placeholder')
          }
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (e.key === 'Enter' && suggestions[0]) {
              e.preventDefault();
              addTag(suggestions[0]);
            }
          }}
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
        />
        {open &&
          createPortal(
            <ul
              ref={bindMenuRef}
              className="store-filter-tag-suggestions store-filter-tag-suggestions--portal"
              role="listbox"
              style={
                menuStyle ??
                (inputRef.current ? computeFloatingMenuStyle(inputRef.current) : undefined)
              }
            >
              {suggestions.map((tag) => (
                <li key={tag.id}>
                  <button type="button" role="option" onClick={() => addTag(tag)}>
                    {tag.name}
                  </button>
                </li>
              ))}
              {loading && (
                <li className="store-filter-tag-suggestion-muted store-filter-tag-suggestion-loading">
                  <Spinner size="sm" />
                  {t('common.loading')}
                </li>
              )}
              {!loading && suggestions.length === 0 && (
                <li className="store-filter-tag-suggestion-muted">{t('filter.tags.noResults')}</li>
              )}
            </ul>,
            document.body,
          )}
      </div>
    </div>
  );
}
