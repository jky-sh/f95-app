import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useStoreLinks } from '../../hooks/useStoreLinks';
import { useT } from '../../lib/i18n';
import { activityRoute } from '../../lib/memberLinks';
import type { GameDetail, GameTag } from '../../types/game';
import type { SamCategory } from '../../types/sam';
import { GameDescription } from './GameDescription';
import { GameDetailField, GameDetailFields, GameDetailTag, GameDetailTagList } from './GameDetailLayout';

/** OP HTML from the sidecar, safe to inject (spoilers stay collapsible). */
export function sanitizeF95Html(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['target', 'rel', 'loading'],
  });
}

/**
 * Click handler for F95 content: threads and members open in the app,
 * everything else in the browser, never by navigating the app window.
 */
export function useF95ContentLinks(): (e: React.MouseEvent) => void {
  const navigate = useNavigate();
  return useCallback(
    (e: React.MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      const href = anchor?.getAttribute('href');
      if (!anchor || !href) return;
      e.preventDefault();
      if (!/^https?:/i.test(href)) return;
      const route = activityRoute(href);
      if (route) navigate(route);
      else void openUrl(href);
    },
    [navigate],
  );
}

/** Long HTML (the changelog) folded to a few lines, with Show more / less. */
export function CollapsibleHtml({ html }: { html: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    setOpen(false);
    const el = bodyRef.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 8);
  }, [html]);
  return (
    <>
      <div
        ref={bodyRef}
        className={`game-detail-collapsible${open ? ' game-detail-collapsible--open' : ''}${
          overflows && !open ? ' game-detail-collapsible--clipped' : ''
        }`}
      >
        <GameDescription
          html={html}
          style={{ fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word' }}
        />
      </div>
      {overflows && (
        <button
          type="button"
          className="game-detail-collapsible-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('common.showLess') : t('common.showMore')}
        </button>
      )}
    </>
  );
}

/** F95 tags, each opening the store filtered by it when the catalog knows it. */
export function StoreTagList({ tags, category }: { tags: GameTag[]; category: SamCategory }) {
  const { t } = useT();
  const links = useStoreLinks(category);
  return (
    <GameDetailTagList>
      {tags.map((tag) => {
        const to = links.tag(tag.name);
        return to ? (
          <Link
            key={tag.slug}
            to={to}
            className="game-detail-tag game-detail-tag-link"
            title={t('gamedetail.moreWith', { name: tag.name })}
          >
            {tag.name}
          </Link>
        ) : (
          <GameDetailTag key={tag.slug}>{tag.name}</GameDetailTag>
        );
      })}
    </GameDetailTagList>
  );
}

const FIELD_ORDER = [
  'Developer',
  'Publisher',
  'Version',
  'Release Date',
  'Thread Updated',
  'OS',
  'Language',
  'Censored',
  'Censorship',
];

const SKIP_FIELDS = new Set(['Overview', 'Genre', 'Installation', 'Changelog']);

/** F95 field labels with a translation; others show as F95 writes them. */
const FIELD_LABEL_KEYS: Record<string, string> = {
  Developer: 'gamedetail.field.developer',
  Publisher: 'gamedetail.field.publisher',
  Version: 'gamedetail.field.version',
  'Release Date': 'gamedetail.meta.releaseDate',
  'Thread Updated': 'gamedetail.field.updated',
  OS: 'gamedetail.field.os',
  Language: 'gamedetail.field.language',
  Censored: 'gamedetail.field.censored',
  Censorship: 'gamedetail.field.censored',
};

/** F95 writes dates as YYYY-MM-DD; show them in the user's format. */
export function formatF95Date(value: string, locale: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The OP's info fields with translated labels and local dates; the developer
 * opens their games in the store. `omit` drops fields a page already shows.
 */
export function StoreInfoFields({
  detail,
  category,
  omit,
}: {
  detail: GameDetail;
  category: SamCategory;
  omit?: string[];
}) {
  const { t, locale } = useT();
  const links = useStoreLinks(category);
  const skip = new Set([...SKIP_FIELDS, ...(omit ?? [])]);
  const ordered = FIELD_ORDER.filter((k) => detail.fields[k] && !skip.has(k));
  const extra = Object.entries(detail.fields).filter(
    ([k]) => !FIELD_ORDER.includes(k) && !skip.has(k),
  );

  function value(key: string, raw: string): ReactNode {
    if (key === 'Developer' || key === 'Publisher') {
      const to = links.developer(raw);
      if (to) {
        return (
          <Link
            to={to}
            className="game-detail-field-link"
            title={t('gamedetail.moreFrom', { name: raw })}
          >
            {raw}
          </Link>
        );
      }
    }
    return formatF95Date(raw, locale) ?? raw;
  }

  if (ordered.length === 0 && extra.length === 0) return null;
  return (
    <GameDetailFields>
      {ordered.map((k) => (
        <GameDetailField
          key={k}
          label={FIELD_LABEL_KEYS[k] ? t(FIELD_LABEL_KEYS[k]) : k}
          value={value(k, detail.fields[k])}
        />
      ))}
      {extra.map(([k, v]) => (
        <GameDetailField key={k} label={k} value={v} />
      ))}
    </GameDetailFields>
  );
}
