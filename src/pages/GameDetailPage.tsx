import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cacheThreadPrefixNames } from '../lib/prefixDisplayCache';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { parseSamCategory } from '../constants/samCategories';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { gameDetail } from '../lib/ipc';
import { dialog } from '../lib/dialog';
import * as library from '../lib/library';
import { GameDescription } from '../components/game/GameDescription';
import { clearGridPreviewCache } from '../lib/gridPreviewQueue';
import { clearRemoteImageQueue } from '../lib/remoteImageQueue';
import { ScreenshotGallery } from '../components/game/ScreenshotGallery';
import { StoreAchievementsSection } from '../components/game/StoreAchievementsSection';
import { DownloadLinks } from '../components/game/DownloadLinks';
import {
  GameDetailBackBar,
  GameDetailBody,
  GameDetailChip,
  GameDetailError,
  GameDetailField,
  GameDetailFields,
  GameDetailHero,
  GameDetailLoading,
  GameDetailMain,
  GameDetailShell,
  GameDetailSection,
  GameDetailStat,
  GameDetailStatGrid,
  GameDetailTag,
  GameDetailTagList,
  GameDetailAside,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  PrefixPill,
} from '../components/game/GameDetailLayout';
import { OfflineGate } from '../components/OfflineGate';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { buildStoreMenu } from '../lib/contextMenus/buildStoreMenu';
import { useT } from '../lib/i18n';
import type { GameDetail, GamePrefix } from '../types/game';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: GameDetail };

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

export function GameDetailPage() {
  return (
    <OfflineGate>
      <GameDetailPageInner />
    </OfflineGate>
  );
}

function GameDetailPageInner() {
  const { threadId } = useParams<{ threadId: string }>();
  const [searchParams] = useSearchParams();
  const category = parseSamCategory(searchParams.get('cat'));
  const navigate = useNavigate();
  const { t } = useT();
  const { isOffline } = useOffline();
  const { openMenuAt } = useContextMenu();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [inLibrary, setInLibrary] = useState(false);
  const [adding, setAdding] = useState(false);

  const openDetailContextMenu = useCallback(
    async (e: React.MouseEvent) => {
      if (state.kind !== 'ready') return;
      e.preventDefault();
      e.stopPropagation();
      const data = state.data;
      const inLib = await library.isInLibrary(data.threadId);
      openMenuAt(
        e.clientX,
        e.clientY,
        buildStoreMenu(
          {
            threadId: data.threadId,
            title: data.title,
            threadUrl: data.threadUrl,
            thumbnailUrl: data.bannerUrl,
            version: data.version,
          },
          {
            navigate,
            category,
            isOffline,
            inLibrary: inLib,
            t,
            onLibraryChange: () => setInLibrary(true),
          },
        ),
      );
    },
    [state, navigate, category, isOffline, t, openMenuAt],
  );

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    gameDetail(threadId)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: 'ready', data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: 'error', message: formatError(err) });
      });
    library
      .isInLibrary(threadId)
      .then((v) => {
        if (!cancelled) setInLibrary(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    cacheThreadPrefixNames(
      state.data.threadId,
      state.data.prefixes.map((p) => p.name),
    );
  }, [state]);

  useEffect(
    () => () => {
      clearRemoteImageQueue();
      clearGridPreviewCache();
    },
    [],
  );

  async function onAddToLibrary() {
    if (state.kind !== 'ready' || adding) return;
    setAdding(true);
    try {
      await library.add({
        threadId: state.data.threadId,
        category,
        title: state.data.title,
        threadUrl: state.data.threadUrl,
        thumbnailUrl: state.data.bannerUrl,
        currentVersion: state.data.version,
      });
      setInLibrary(true);
    } catch (err) {
      await dialog.alert(formatError(err), { kind: 'error' });
    } finally {
      setAdding(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo="/store"
          breadcrumbLabel={t('nav.store')}
        />
        <GameDetailLoading />
      </GameDetailShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo="/store"
          breadcrumbLabel={t('nav.store')}
        />
        <GameDetailError message={state.message} />
      </GameDetailShell>
    );
  }

  const g = state.data;
  const displayPrefixes = normalizeDetailPrefixes(g.prefixes, g.version);
  const sanitized = DOMPurify.sanitize(g.descriptionHtml, {
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['target', 'rel', 'loading'],
  });

  const orderedFields = FIELD_ORDER.filter((k) => g.fields[k]);
  const extraFields = Object.entries(g.fields).filter(
    ([k]) => !FIELD_ORDER.includes(k) && !SKIP_FIELDS.has(k),
  );

  return (
    <GameDetailShell onContextMenu={openDetailContextMenu}>
      <GameDetailBackBar
        onBack={() => navigate(-1)}
        breadcrumbTo="/store"
        breadcrumbLabel={t('nav.store')}
      />

      <GameDetailHero
        bannerUrl={g.bannerUrl}
        coverUrl={g.bannerUrl}
        badges={
          <>
            {displayPrefixes.map((p) => (
              <PrefixPill key={p.name} name={p.name} cssClass={p.cssClass} />
            ))}
          </>
        }
        title={g.title}
        meta={buildHeroMeta(g, t)}
        actions={
          <>
            {inLibrary ? (
              <GameDetailBtnPrimary as="a" to={`/library/game/${g.threadId}`}>
                {t('gamedetail.action.openInLibrary')}
              </GameDetailBtnPrimary>
            ) : (
              <GameDetailBtnPrimary onClick={onAddToLibrary} disabled={adding}>
                {adding ? t('gamedetail.action.adding') : t('gamedetail.action.addToLibrary')}
              </GameDetailBtnPrimary>
            )}
            <GameDetailBtnSecondary onClick={() => openUrl(g.threadUrl)}>
              {t('gamedetail.action.openThread')}
            </GameDetailBtnSecondary>
          </>
        }
      />

      <GameDetailStatGrid>
        {g.fields['Developer'] && (
          <GameDetailStat label={t('gamedetail.field.developer')} value={g.fields['Developer']} />
        )}
        {g.fields['Publisher'] && (
          <GameDetailStat label={t('gamedetail.field.publisher')} value={g.fields['Publisher']} />
        )}
        {g.version && (
          <GameDetailStat label={t('gamedetail.field.version')} value={g.version} highlight />
        )}
        {g.fields['Thread Updated'] && (
          <GameDetailStat
            label={t('gamedetail.field.updated')}
            value={g.fields['Thread Updated']}
          />
        )}
        {g.fields['OS'] && (
          <GameDetailStat
            label={t('gamedetail.field.os')}
            value={g.fields['OS']}
            className="game-detail-stat-wide"
          />
        )}
        {g.downloads.length > 0 && (
          <GameDetailStat
            label={t('gamedetail.field.downloads')}
            value={t('gamedetail.field.downloadsCount', { count: g.downloads.length })}
          />
        )}
      </GameDetailStatGrid>

      <GameDetailBody>
        <GameDetailMain>
          {g.screenshots.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.screenshots')}>
              <ScreenshotGallery images={g.screenshots} />
            </GameDetailSection>
          )}

          {g.tags.length > 0 && (
            <GameDetailSection title={t('gamedetail.section.tags')}>
              <GameDetailTagList>
                {g.tags.map((tag) => (
                  <GameDetailTag key={tag.slug}>{tag.name}</GameDetailTag>
                ))}
              </GameDetailTagList>
            </GameDetailSection>
          )}

          <GameDetailSection title={t('gamedetail.section.about')}>
            <GameDescription
              html={sanitized}
              style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
            />
          </GameDetailSection>

          {category === 'games' && <StoreAchievementsSection detail={g} />}
        </GameDetailMain>

        <GameDetailAside>
          <GameDetailSection title={t('gamedetail.section.info')}>
            <GameDetailFields>
              {orderedFields.map((k) => (
                <GameDetailField key={k} label={k} value={g.fields[k]} />
              ))}
              {extraFields.map(([k, v]) => (
                <GameDetailField key={k} label={k} value={v} />
              ))}
            </GameDetailFields>
          </GameDetailSection>

          <GameDetailSection title={t('dl.section')} className="game-detail-downloads">
            <DownloadLinks
              embedded
              game={{
                threadId: g.threadId,
                category,
                title: g.title,
                threadUrl: g.threadUrl,
                thumbnailUrl: g.bannerUrl,
                version: g.version,
              }}
              downloads={g.downloads}
              social={g.social}
            />
          </GameDetailSection>
        </GameDetailAside>
      </GameDetailBody>
    </GameDetailShell>
  );
}

function normMetaKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Avoid showing the same text twice (e.g. version in Release Date field). */
function metaValuesMatch(a: string, b: string): boolean {
  const ka = normMetaKey(a);
  const kb = normMetaKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes(kb) || kb.includes(ka)) {
    if (/\d{4}-\d{2}-\d{2}/.test(ka) || /\d{4}-\d{2}-\d{2}/.test(kb)) return true;
    if (ka.replace(/^v\.?/, '') === kb.replace(/^v\.?/, '')) return true;
  }
  return false;
}

function truncateChip(text: string, max = 52): string {
  const s = text.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function buildHeroMeta(
  g: GameDetail,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  const seen = new Set<string>();
  const chips: ReactNode[] = [];

  const push = (key: string, node: ReactNode) => {
    if (seen.has(key)) return;
    seen.add(key);
    chips.push(node);
  };

  if (g.developer) {
    push(
      normMetaKey(g.developer),
      <GameDetailChip title={t('gamedetail.meta.developer')}>{g.developer}</GameDetailChip>,
    );
  }

  if (g.version) {
    push(
      normMetaKey(g.version),
      <GameDetailChip accent title={t('gamedetail.meta.version')}>
        {g.version}
      </GameDetailChip>,
    );
  }

  const release = g.fields['Release Date']?.trim();
  if (release && !metaValuesMatch(release, g.version ?? '')) {
    const updated = g.fields['Thread Updated']?.trim() ?? '';
    if (!updated || !metaValuesMatch(release, updated)) {
      push(
        normMetaKey(release),
        <GameDetailChip title={t('gamedetail.meta.releaseDate')}>{release}</GameDetailChip>,
      );
    }
  }

  const os = g.fields['OS']?.trim();
  if (os) {
    push(
      normMetaKey(os),
      <GameDetailChip title={os} className="game-detail-chip-truncate">
        {truncateChip(os)}
      </GameDetailChip>,
    );
  }

  return <>{chips}</>;
}

function normalizeDetailPrefixes(
  prefixes: GamePrefix[],
  version: string | null,
): GamePrefix[] {
  const seen = new Set<string>();
  const out: GamePrefix[] = [];
  const versionKey = version?.trim().toLowerCase() ?? '';

  for (const p of prefixes) {
    const name = p.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (versionKey && key === versionKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}
