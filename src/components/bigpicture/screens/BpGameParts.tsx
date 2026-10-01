import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as ipc from '../../../lib/ipc';
import * as library from '../../../lib/library';
import * as steamAchievements from '../../../lib/steamAchievements';
import { formatDay } from '../../../lib/memberPresence';
import { useT } from '../../../lib/i18n';
import { formatF95Date } from '../../game/StoreDetailSections';
import { LazyRemoteImage } from '../../game/LazyRemoteImage';
import { Icon } from '../../ui/Icon';
import type { GameDetail } from '../../../types/game';
import type { LibraryGame } from '../../../types/library';
import type { SteamAchievement } from '../../../types/achievements';
import { useBp } from '../BpContext';
import { BpEmpty, BpGrid, BpLoader } from '../BpParts';

/* ------------------------------------------------------------------------- */
/* Thread text                                                                */
/* ------------------------------------------------------------------------- */

/** Info lines of an F95 OP ("Developer: …"): shown as facts, cut from the story. */
const INFO_LINE =
  /^(thread updated|updated|release date|developer|publisher|censored|censorship|version|os|platform|language|languages|genre|store|installation|changelog|developer notes|prequel|sequel|voiced|length|original title|other games|support the developer)\s*:/i;

function textLines(html: string): string[] {
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n'),
    'text/html',
  );
  // Spoilers and quotes are extras (changelogs, credits), not the story.
  for (const el of doc.querySelectorAll('.bbCodeSpoiler, blockquote, script, style')) el.remove();
  return (doc.body.textContent ?? '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());
}

function paragraphs(lines: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line) {
      current.push(line);
    } else if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

/** The story of an OP: after its "Overview:" label, up to the first info line. */
export function overviewOf(html: string): string[][] {
  const lines = textLines(html);
  let start = lines.findIndex((l) => /^overview\s*:/i.test(l));
  if (start >= 0) lines[start] = lines[start].replace(/^overview\s*:\s*/i, '');
  else start = 0;
  let end = lines.findIndex((l, i) => i > start && INFO_LINE.test(l));
  if (end < 0) end = lines.length;
  return paragraphs(lines.slice(start, end));
}

/** Changelog lines as paragraphs, capped so a years-long log stays readable. */
export function changelogOf(html: string, maxLines = 80): string[][] {
  return paragraphs(textLines(html).slice(0, maxLines));
}

/**
 * Long text the controller can read: it takes the focus like any control and
 * up/down scroll through it before moving on (see scrollThrough).
 */
export function BpReadingBlock({ blocks, className }: { blocks: string[][]; className?: string }) {
  const { t } = useT();
  return (
    <div
      className={`bp-read bp-focusable${className ? ` ${className}` : ''}`}
      tabIndex={0}
      data-bp-a={t('bp.hint.read')}
    >
      {blocks.map((lines, i) => (
        <p key={i}>
          {lines.map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Facts                                                                      */
/* ------------------------------------------------------------------------- */

export interface Fact {
  label: string;
  value: string;
}

const NO_FACTS: Fact[] = [];

/** The OP's info fields (developer, dates, platforms…) with translated labels. */
export function useThreadFacts(detail: GameDetail | null, extra: Fact[] = NO_FACTS): Fact[] {
  const { t, locale } = useT();
  return useMemo(() => {
    const out: Fact[] = [...extra];
    if (!detail) return out;
    const f = detail.fields;
    const date = (v: string | undefined) => (v ? (formatF95Date(v, locale) ?? v) : null);
    const push = (label: string, value: string | null | undefined) => {
      if (value && value.trim() && !out.some((x) => x.label === label)) out.push({ label, value: value.trim() });
    };
    push(t('gamedetail.field.developer'), f['Developer'] ?? detail.developer);
    push(t('gamedetail.field.publisher'), f['Publisher']);
    push(t('gamedetail.field.version'), f['Version'] ?? detail.version);
    push(t('gamedetail.meta.releaseDate'), date(f['Release Date']));
    push(t('gamedetail.field.updated'), date(f['Thread Updated']));
    push(t('gamedetail.field.os'), f['OS'] ?? f['Platform']);
    push(t('gamedetail.field.language'), f['Language'] ?? f['Languages']);
    push(t('gamedetail.field.censored'), f['Censored'] ?? f['Censorship']);
    if (detail.rating) {
      push(
        t('gamedetail.meta.rating'),
        t('bp.game.ratingValue', { rating: detail.rating.average.toFixed(1), votes: detail.rating.votes }),
      );
    }
    return out;
  }, [detail, extra, t, locale]);
}

export function BpFacts({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="bp-facts">
      {facts.map((f) => (
        <div key={f.label} className="bp-fact">
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BpTagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="bp-tags">
      {tags.map((tag) => (
        <span key={tag} className="bp-tag">
          {tag}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Screenshots                                                                */
/* ------------------------------------------------------------------------- */

/** Every screenshot as a grid; A opens them full screen. */
export function BpScreenshotGrid({ images }: { images: string[] }) {
  const { t } = useT();
  const bp = useBp();
  if (images.length === 0) return <BpEmpty icon="eye" title={t('bp.game.noScreenshots')} />;
  return (
    <BpGrid className="bp-shots">
      {images.map((src, i) => (
        <button
          key={src}
          type="button"
          className="bp-shot bp-focusable"
          style={{ '--i': Math.min(i, 14) } as React.CSSProperties}
          data-bp-a={t('bp.hint.view')}
          onClick={() => bp.openViewer(images, i)}
        >
          <LazyRemoteImage src={src} upgrade="grid" priority={4} alt="" className="bp-shot-img" rootMargin="400px 0px" />
        </button>
      ))}
    </BpGrid>
  );
}

/* ------------------------------------------------------------------------- */
/* Achievements                                                               */
/* ------------------------------------------------------------------------- */

export interface AchievementsState {
  linked: boolean;
  list: SteamAchievement[] | null;
  error: string | null;
  unlocked: number;
  total: number;
}

/**
 * The game's Steam achievements (see GameAchievementsSection): the cached
 * list at once, refreshed in the background and live as unlocks arrive.
 */
export function useGameAchievements(game: LibraryGame | null): AchievementsState & { reload: () => void } {
  const { locale } = useT();
  const [list, setList] = useState<SteamAchievement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appid = game?.steamAppid || null;
  const threadId = game?.threadId ?? null;

  const reload = useCallback(async () => {
    if (!appid || !threadId) return;
    setError(null);
    const cached = await steamAchievements.listForGame(threadId, appid).catch(() => [] as SteamAchievement[]);
    if (cached.length > 0) setList(cached);
    try {
      await steamAchievements.ensureSchema(appid, locale);
      setList(await steamAchievements.listForGame(threadId, appid));
    } catch (err) {
      if (cached.length === 0) {
        setError(err instanceof Error ? err.message : String(err));
        setList([]);
      }
    }
  }, [appid, threadId, locale]);

  useEffect(() => {
    if (!appid || !threadId) {
      setList(null);
      return;
    }
    let cancelled = false;
    void reload();
    void ipc.achievementsScanNow().catch(() => undefined);
    let unlisten: UnlistenFn | null = null;
    void listen<{ threadId: string }>(steamAchievements.ACHIEVEMENTS_UPDATED_EVENT, (e) => {
      if (!cancelled && e.payload.threadId === threadId) void reload();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appid, threadId, reload]);

  const unlocked = list?.filter((a) => a.unlocked).length ?? 0;
  return { linked: !!appid, list, error, unlocked, total: list?.length ?? 0, reload: () => void reload() };
}

export function BpAchievements({
  game,
  detail,
  state,
}: {
  game: LibraryGame;
  detail: GameDetail | null;
  state: AchievementsState;
}) {
  const { t, locale } = useT();
  const bp = useBp();
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!state.list) return [];
    // Unlocked first (newest first), then the locked ones from the most common.
    return [...state.list].sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      if (a.unlocked) return (b.unlockTime ?? 0) - (a.unlockTime ?? 0);
      return (b.globalPercent ?? 0) - (a.globalPercent ?? 0);
    });
  }, [state.list]);

  async function detect() {
    setDetecting(true);
    setMessage(null);
    try {
      const found = await steamAchievements.autoDetectAppid({
        title: game.title,
        installPath: game.installPath,
        exePath: game.exePath,
        storeDetail: detail,
      });
      if (!found) {
        setMessage(t('ach.link.notFound'));
        return;
      }
      await steamAchievements.ensureSchema(found.appId, locale);
      await library.setSteamAppid(game.threadId, found.appId);
      await steamAchievements.syncWatcher();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  }

  if (!state.linked) {
    return (
      <div className="bp-ach-link">
        <Icon name="star" size={40} strokeWidth={1.5} />
        <h3>{t('bp.ach.unlinked')}</h3>
        <p>{t('bp.ach.unlinkedHint')}</p>
        {message && <p className="bp-ach-message">{message}</p>}
        <div className="bp-actions">
          <button
            type="button"
            className="bp-btn bp-btn--primary bp-focusable"
            disabled={detecting}
            onClick={() => void detect()}
          >
            <Icon name="search" size={20} />
            {detecting ? t('ach.link.working') : t('ach.link.detect')}
          </button>
          <button type="button" className="bp-btn bp-focusable" onClick={() => bp.exit(`/library/game/${game.threadId}`)}>
            <Icon name="monitor" size={20} />
            {t('bp.ach.linkDesktop')}
          </button>
        </div>
      </div>
    );
  }

  if (!state.list) return <BpLoader label={t('common.loading')} />;
  if (state.list.length === 0) {
    return <BpEmpty icon="star" title={t('bp.ach.none')} text={state.error ?? undefined} />;
  }

  const pct = Math.round((state.unlocked / state.total) * 100);
  return (
    <div className="bp-ach">
      <div className="bp-ach-summary">
        <span className="bp-ach-count">{t('bp.ach.progress', { unlocked: state.unlocked, total: state.total })}</span>
        <span className="bp-ach-bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="bp-ach-pct">{pct}%</span>
      </div>
      <div className="bp-ach-list">
        {sorted.map((a) => {
          const secret = a.hidden && !a.unlocked;
          return (
            <div
              key={a.apiName}
              className={`bp-ach-item bp-focusable${a.unlocked ? ' is-unlocked' : ''}`}
              tabIndex={0}
            >
              <img className="bp-ach-icon" src={a.unlocked ? a.iconUrl : a.iconGrayUrl || a.iconUrl} alt="" />
              <span className="bp-ach-text">
                <span className="bp-ach-name">{secret ? t('bp.ach.hidden') : a.displayName}</span>
                <span className="bp-ach-desc">{secret ? t('bp.ach.hiddenHint') : a.description}</span>
              </span>
              <span className="bp-ach-meta">
                {a.unlocked
                  ? a.unlockTime
                    ? formatDay(a.unlockTime, locale)
                    : t('bp.ach.unlocked')
                  : a.globalPercent != null
                    ? t('bp.ach.rarity', { pct: a.globalPercent.toFixed(1) })
                    : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
