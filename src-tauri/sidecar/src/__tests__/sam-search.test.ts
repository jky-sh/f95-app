import { describe, expect, it } from 'vitest';
import {
  buildSearchVariants,
  normalizeSearchQuery,
  rankSamItems,
  scoreSearchMatch,
} from '../domain/sam/search';

describe('normalizeSearchQuery', () => {
  it('strips version brackets and punctuation', () => {
    expect(normalizeSearchQuery('Being a DIK [v0.8.0]')).toBe('being a dik');
    expect(normalizeSearchQuery("  Summertime Saga!!!  ")).toBe('summertime saga');
  });

  it('removes diacritics', () => {
    expect(normalizeSearchQuery('Pokémon')).toBe('pokemon');
  });
});

describe('buildSearchVariants', () => {
  it('returns progressive fallbacks for multi-word queries', () => {
    const variants = buildSearchVariants('Being a DIK Remastered');
    expect(variants[0]).toBe('being a dik remastered');
    expect(variants).toContain('being a dik');
    expect(variants.some((v) => v === 'being' || v === 'dik' || v === 'remastered')).toBe(true);
  });

  it('returns empty for blank input', () => {
    expect(buildSearchVariants('   ')).toEqual([]);
  });
});

describe('scoreSearchMatch / rankSamItems', () => {
  const cards = [
    {
      threadId: '1',
      title: 'Random Adventure',
      creator: 'dev',
      likes: 10,
      views: 100,
      updatedTs: 1,
    },
    {
      threadId: '2',
      title: 'Being a DIK',
      creator: 'DrPinkCake',
      likes: 5000,
      views: 100000,
      updatedTs: 2,
    },
    {
      threadId: '3',
      title: 'Being a Hero',
      creator: 'other',
      likes: 20,
      views: 200,
      updatedTs: 3,
    },
  ];

  it('scores exact-ish title matches highest', () => {
    expect(scoreSearchMatch(cards[1], 'being a dik')).toBeGreaterThan(
      scoreSearchMatch(cards[2], 'being a dik'),
    );
  });

  it('ranks best title match first', () => {
    const ranked = rankSamItems(cards, 'being a dik');
    expect(ranked[0].threadId).toBe('2');
  });
});
