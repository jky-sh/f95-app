import { useCallback, useEffect, useMemo, useState } from 'react';
import { SAM_CATEGORIES } from '../../../constants/samCategories';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { parseDbTime } from '../../../lib/dbTime';
import { useT } from '../../../lib/i18n';
import { formatPlaytime, type LibraryGame } from '../../../types/library';
import type { SamCategory } from '../../../types/sam';
import { useBp, useBpGames } from '../BpContext';
import { BpEmpty, BpGameTile, BpGrid, BpLoader } from '../BpParts';

type StatusFilter = 'all' | 'installed' | 'update_available' | 'not_installed';
type Sort = 'last_played' | 'title' | 'playtime' | 'added';

const STATUS: { id: StatusFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'library.filter.all' },
  { id: 'installed', labelKey: 'library.filter.installed' },
  { id: 'update_available', labelKey: 'library.filter.update' },
  { id: 'not_installed', labelKey: 'library.filter.notInstalled' },
];

const SORTS: { id: Sort; labelKey: string }[] = [
  { id: 'last_played', labelKey: 'library.sort.lastPlayed' },
  { id: 'added', labelKey: 'library.sort.added' },
  { id: 'title', labelKey: 'library.sort.title' },
  { id: 'playtime', labelKey: 'library.sort.playtime' },
];

const time = (v: string | null) => parseDbTime(v)?.getTime() ?? 0;

function sortGames(games: LibraryGame[], sort: Sort, locale: string): LibraryGame[] {
  const out = [...games];
  switch (sort) {
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title, locale, { sensitivity: 'base' }));
    case 'playtime':
      return out.sort((a, b) => b.totalPlaytimeSeconds - a.totalPlaytimeSeconds);
    case 'added':
      return out.sort((a, b) => time(b.addedAt) - time(a.addedAt));
    case 'last_played':
    default:
      // Never played go last, newest additions first among them.
      return out.sort(
        (a, b) => time(b.lastPlayedAt) - time(a.lastPlayedAt) || time(b.addedAt) - time(a.addedAt),
      );
  }
}

function Chip({
  pressed,
  label,
  count,
  onClick,
}: {
  pressed: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="bp-chip bp-focusable" aria-pressed={pressed} onClick={onClick}>
      {label}
      {count != null && <span className="bp-chip-count">{count}</span>}
    </button>
  );
}

/** The whole library as a grid, with the filters a controller can reach. */
export function BpLibrary() {
  const { t, locale } = useT();
  const bp = useBp();
  const games = useBpGames();
  const downloads = useDownloadsByThread();
  const [category, setCategory] = useState<SamCategory>('games');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('last_played');
  const [art, setArt] = useState<string | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<SamCategory, number>();
    for (const g of games ?? []) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
    return SAM_CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({ ...c, count: counts.get(c.id)! }));
  }, [games]);

  // A category that emptied out (last item removed): back to one that has items.
  useEffect(() => {
    if (categories.length && !categories.some((c) => c.id === category)) setCategory(categories[0].id);
  }, [categories, category]);

  const inCategory = useMemo(() => (games ?? []).filter((g) => g.category === category), [games, category]);
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: inCategory.length, installed: 0, update_available: 0, not_installed: 0 };
    for (const g of inCategory) {
      if (g.installStatus in counts) counts[g.installStatus as StatusFilter] += 1;
    }
    return counts;
  }, [inCategory]);
  const shown = useMemo(
    () =>
      sortGames(
        status === 'all' ? inCategory : inCategory.filter((g) => g.installStatus === status),
        sort,
        locale,
      ),
    [inCategory, status, sort, locale],
  );

  const firstArt = shown[0]?.thumbnailUrl ?? null;
  useEffect(() => {
    const timer = window.setTimeout(() => bp.setBackdrop(art ?? firstArt), 140);
    return () => window.clearTimeout(timer);
  }, [bp, art, firstArt]);

  const onFocusGame = useCallback((g: LibraryGame) => setArt(g.thumbnailUrl), []);

  if (!games) {
    return (
      <div className="bp-screen-body bp-center" data-bp-scroll-y="">
        <BpLoader label={t('common.loading')} />
      </div>
    );
  }

  return (
    <div className="bp-screen-body bp-page" data-bp-scroll-y="">
      <div className="bp-filters">
        {categories.length > 1 && (
          <div className="bp-chip-row" data-bp-group="lib-category" data-bp-row="">
            {categories.map((c) => (
              <Chip
                key={c.id}
                pressed={c.id === category}
                label={c.literal ?? t(c.labelKey)}
                count={c.count}
                onClick={() => setCategory(c.id)}
              />
            ))}
          </div>
        )}
        <div className="bp-filter-line">
          <div className="bp-chip-row" data-bp-group="lib-status" data-bp-row="">
            {STATUS.map((s) => (
              <Chip
                key={s.id}
                pressed={s.id === status}
                label={t(s.labelKey)}
                count={statusCounts[s.id]}
                onClick={() => setStatus(s.id)}
              />
            ))}
          </div>
          <div className="bp-chip-row bp-chip-row--sort" data-bp-group="lib-sort" data-bp-row="">
            <span className="bp-chip-label">{t('library.sort.label')}</span>
            {SORTS.map((s) => (
              <Chip key={s.id} pressed={s.id === sort} label={t(s.labelKey)} onClick={() => setSort(s.id)} />
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <BpEmpty
          icon="library"
          title={games.length === 0 ? t('bp.home.empty.title') : t('bp.library.empty')}
          text={games.length === 0 ? t('bp.home.empty.text') : undefined}
          action={
            games.length === 0 ? (
              <button type="button" className="bp-btn bp-btn--primary bp-focusable" onClick={() => bp.switchTab('store')}>
                {t('bp.home.empty.cta')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <BpGrid key={`${category}-${status}-${sort}`}>
          {shown.map((g, i) => (
            <BpGameTile
              key={g.threadId}
              game={g}
              group="library"
              index={i}
              autoFocus={i === 0}
              download={downloads.get(g.threadId)}
              sub={formatPlaytime(g.totalPlaytimeSeconds)}
              onFocusGame={onFocusGame}
            />
          ))}
        </BpGrid>
      )}
    </div>
  );
}
