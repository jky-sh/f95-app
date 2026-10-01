/** Minimal card shape used for relevance ranking (avoids circular imports). */
export interface SearchableCard {
  threadId: string;
  title: string;
  creator: string | null;
  likes: number | null;
  views: number | null;
  updatedTs: number | null;
}

export interface SearchablePage<T extends SearchableCard = SearchableCard> {
  page: number;
  totalPages: number;
  totalRows: number;
  items: T[];
  endpoint: string;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'to',
  'in',
  'for',
  'with',
  'on',
  'at',
  'by',
  'from',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'o',
  'os',
  'as',
  'um',
  'uma',
]);

/** Normalize a user query into a looser, SAM-friendly search string. */
export function normalizeSearchQuery(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Build progressive search variants (full phrase → significant tokens → longest token).
 * First variant is preferred; later ones are fallbacks when SAM returns nothing.
 */
export function buildSearchVariants(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const normalized = normalizeSearchQuery(trimmed);
  const variants: string[] = [];
  const push = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!variants.some((x) => x.toLowerCase() === v.toLowerCase())) {
      variants.push(v);
    }
  };

  push(normalized);
  push(trimmed);

  // Keep short stopwords (e.g. "a") so phrase fallbacks stay natural.
  const tokens = (normalized || trimmed.toLowerCase())
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t.length >= 1);

  const significant = tokens.filter((t) => !STOP_WORDS.has(t) && t.length >= 3);
  if (significant.length > 0 && significant.join(' ') !== normalized) {
    push(significant.join(' '));
  }

  // Progressive suffix drop keeps stopwords in the phrase:
  // "being a dik remastered" → "being a dik" → "being a"
  if (tokens.length >= 3) {
    for (let len = tokens.length - 1; len >= 2; len--) {
      push(tokens.slice(0, len).join(' '));
    }
  }

  const byLength = [...significant].sort((a, b) => b.length - a.length);
  for (const token of byLength) {
    push(token);
  }

  return variants;
}

export function scoreSearchMatch(card: SearchableCard, query: string): number {
  const q = normalizeSearchQuery(query);
  if (!q) return 0;

  const title = normalizeSearchQuery(card.title);
  const creator = normalizeSearchQuery(card.creator ?? '');
  const tokens = q.split(/\s+/).filter(Boolean);

  let score = 0;
  if (title === q) score += 1000;
  if (title.startsWith(q)) score += 400;
  if (title.includes(q)) score += 250;

  let matchedTokens = 0;
  for (const token of tokens) {
    if (title.includes(token)) {
      matchedTokens += 1;
      score += token.length >= 4 ? 40 : 20;
      if (title.split(/\s+/).some((w) => w.startsWith(token))) score += 15;
    } else if (creator.includes(token)) {
      matchedTokens += 1;
      score += 10;
    }
  }

  if (tokens.length > 0 && matchedTokens === tokens.length) score += 80;
  if (creator && creator.includes(q)) score += 30;

  // Prefer popular / recent among equal textual matches.
  score += Math.min(40, Math.log10((card.likes ?? 0) + 1) * 12);
  score += Math.min(20, Math.log10((card.views ?? 0) + 1) * 4);

  return score;
}

export function rankSamItems<T extends SearchableCard>(items: T[], query: string): T[] {
  if (!query.trim() || items.length <= 1) return items;
  return [...items].sort((a, b) => {
    const diff = scoreSearchMatch(b, query) - scoreSearchMatch(a, query);
    if (diff !== 0) return diff;
    return (b.updatedTs ?? 0) - (a.updatedTs ?? 0);
  });
}

export function rankSamPage<T extends SearchableCard>(
  page: SearchablePage<T>,
  query: string,
): SearchablePage<T> {
  return { ...page, items: rankSamItems(page.items, query) };
}

export function mergeSamPages<T extends SearchableCard>(
  pages: SearchablePage<T>[],
  query: string,
  rows: number,
): SearchablePage<T> {
  const seen = new Set<string>();
  const items: T[] = [];
  let totalRows = 0;
  let endpoint = pages[0]?.endpoint ?? '';

  for (const page of pages) {
    totalRows = Math.max(totalRows, page.totalRows);
    if (page.endpoint) endpoint = page.endpoint;
    for (const item of page.items) {
      if (seen.has(item.threadId)) continue;
      seen.add(item.threadId);
      items.push(item);
    }
  }

  const ranked = rankSamItems(items, query).slice(0, rows);
  const total = Math.max(totalRows, ranked.length);
  return {
    page: 1,
    totalPages: Math.max(1, Math.ceil(total / Math.max(1, rows))),
    totalRows: total,
    items: ranked,
    endpoint,
  };
}
