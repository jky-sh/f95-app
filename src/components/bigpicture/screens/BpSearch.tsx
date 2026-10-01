import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOffline } from '../../../contexts/Offline';
import { useDownloadsByThread } from '../../../hooks/useDownloadsByThread';
import { useLibraryIndex } from '../../../hooks/useLibraryIndex';
import { useSamList } from '../../../hooks/useSamList';
import { useT } from '../../../lib/i18n';
import { formatPlaytime, type LibraryGame } from '../../../types/library';
import { Icon } from '../../ui/Icon';
import { useBp, useBpGames } from '../BpContext';
import { focusElement, useInputMethod } from '../bpInput';
import { BpEmpty, BpLoader, BpShelf, BpStoreTile, BpGameTile } from '../BpParts';

/** Lowercase without accents, so "pokemon" finds "Pokémon". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl\'', 'zxcvbnm-.:'];
const MAX_LIBRARY_HITS = 24;
const MIN_STORE_QUERY = 2;

/** The query survives leaving the screen, like a search box would. */
let lastQuery = '';

/** One search over the library (instant) and the store (as you pause). */
export function BpSearch() {
  const { t } = useT();
  const bp = useBp();
  const games = useBpGames();
  const method = useInputMethod();
  const { isOffline } = useOffline();
  const libraryIndex = useLibraryIndex();
  const downloads = useDownloadsByThread();
  const [query, setQueryState] = useState(lastQuery);
  const [storeQuery, setStoreQuery] = useState(lastQuery.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const setQuery = useCallback((next: string | ((prev: string) => string)) => {
    setQueryState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      lastQuery = value;
      return value;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setStoreQuery(query.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  const tokens = useMemo(() => fold(query.trim()).split(/\s+/).filter(Boolean), [query]);
  const libraryHits = useMemo(() => {
    if (!games || tokens.length === 0) return [];
    const head = tokens.join(' ');
    return games
      .filter((g) => {
        const hay = fold(g.title);
        return tokens.every((tok) => hay.includes(tok));
      })
      .sort((a, b) => Number(fold(b.title).startsWith(head)) - Number(fold(a.title).startsWith(head)))
      .slice(0, MAX_LIBRARY_HITS);
  }, [games, tokens]);

  const searchStore = !isOffline && storeQuery.length >= MIN_STORE_QUERY;
  const store = useSamList({ category: 'games', search: storeQuery || undefined, rows: 24 }, { enabled: searchStore });

  const focusResults = useCallback(() => {
    const first = resultsRef.current?.querySelector<HTMLElement>('.bp-focusable');
    if (first) focusElement(first);
  }, []);

  const onFocusGame = useCallback((g: LibraryGame) => bp.setBackdrop(g.thumbnailUrl), [bp]);

  const typed = query.trim().length > 0;
  const gamepad = method === 'gamepad';

  return (
    <div className="bp-screen-body bp-page bp-search" data-bp-scroll-y="">
      <div className="bp-search-bar">
        <Icon name="search" size={26} />
        <input
          ref={inputRef}
          className="bp-search-input bp-focusable"
          data-bp-autofocus={!gamepad || undefined}
          value={query}
          placeholder={t('bp.search.placeholder')}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              focusResults();
            }
          }}
        />
        {typed && (
          <button
            type="button"
            className="bp-icon-btn bp-focusable"
            aria-label={t('bp.keyboard.clear')}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <Icon name="x" size={20} />
          </button>
        )}
      </div>

      {gamepad && (
        <div className="bp-osk" role="group" aria-label={t('bp.keyboard')}>
          {KEY_ROWS.map((row, r) => (
            <div key={row} className="bp-osk-row">
              {[...row].map((ch, c) => (
                <button
                  key={ch}
                  type="button"
                  className="bp-osk-key bp-focusable"
                  data-bp-autofocus={r === 1 && c === 0 ? '' : undefined}
                  onClick={() => setQuery((q) => q + ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
          ))}
          <div className="bp-osk-row">
            <button type="button" className="bp-osk-key bp-osk-key--wide bp-focusable" onClick={() => setQuery((q) => q + ' ')}>
              {t('bp.keyboard.space')}
            </button>
            <button type="button" className="bp-osk-key bp-osk-key--wide bp-focusable" onClick={() => setQuery((q) => q.slice(0, -1))}>
              ⌫ {t('bp.keyboard.backspace')}
            </button>
            <button type="button" className="bp-osk-key bp-osk-key--wide bp-focusable" onClick={() => setQuery('')}>
              {t('bp.keyboard.clear')}
            </button>
            <button
              type="button"
              className="bp-osk-key bp-osk-key--wide bp-osk-key--go bp-focusable"
              disabled={!typed}
              onClick={focusResults}
            >
              {t('bp.keyboard.done')}
            </button>
          </div>
        </div>
      )}

      <div className="bp-search-results" ref={resultsRef}>
        {!typed ? (
          <BpEmpty icon="search" title={t('bp.search.hint')} />
        ) : (
          <>
            {libraryHits.length > 0 && (
              <BpShelf id="search-library" title={t('bp.search.library')} count={libraryHits.length} snap="none">
                {libraryHits.map((g, i) => (
                  <BpGameTile
                    key={g.threadId}
                    game={g}
                    group="search-library"
                    index={i}
                    download={downloads.get(g.threadId)}
                    sub={formatPlaytime(g.totalPlaytimeSeconds)}
                    onFocusGame={onFocusGame}
                  />
                ))}
              </BpShelf>
            )}
            {searchStore && (
              <BpShelf
                id="search-store"
                snap="none"
                title={t('bp.search.store')}
                count={store.items.length > 0 ? store.totalRows || store.items.length : null}
              >
                {store.items.length === 0 ? (
                  store.loading ? (
                    <BpLoader label={t('common.loading')} />
                  ) : (
                    <span className="bp-muted">{t('bp.search.none')}</span>
                  )
                ) : (
                  store.items.map((card, i) => (
                    <BpStoreTile
                      key={card.threadId}
                      card={card}
                      category="games"
                      group="search-store"
                      index={i}
                      entry={libraryIndex.get(card.threadId)}
                    />
                  ))
                )}
              </BpShelf>
            )}
            {libraryHits.length === 0 && !searchStore && <BpEmpty icon="search" title={t('bp.search.none')} />}
          </>
        )}
      </div>
    </div>
  );
}
