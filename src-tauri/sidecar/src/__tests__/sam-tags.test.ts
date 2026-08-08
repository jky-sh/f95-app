import { describe, expect, it } from 'vitest';
import { normalizeSamTags } from '../domain/sam/client';

describe('normalizeSamTags', () => {
  it('resolves plain numeric ids via catalog', () => {
    const catalog = new Map<number, string>([
      [107, '3dcg'],
      [162, 'adventure'],
    ]);
    const tags = normalizeSamTags(JSON.stringify({ status: 'ok', msg: [107, 162, 999] }), catalog);
    expect(tags).toEqual([
      { id: 107, name: '3dcg' },
      { id: 162, name: 'adventure' },
    ]);
  });

  it('parses object tag entries with names', () => {
    const tags = normalizeSamTags(
      JSON.stringify({
        status: 'ok',
        msg: {
          data: [
            { id: 30, name: 'incest' },
            { tag_id: 75, label: 'milf' },
          ],
        },
      }),
      new Map(),
    );
    expect(tags).toEqual([
      { id: 30, name: 'incest' },
      { id: 75, name: 'milf' },
    ]);
  });

  it('parses id→name map payloads', () => {
    const tags = normalizeSamTags(
      JSON.stringify({ status: 'ok', msg: { tags: { '2214': '2d game', '1507': '2dcg' } } }),
      new Map(),
    );
    expect(tags.map((t) => t.id).sort((a, b) => a - b)).toEqual([1507, 2214]);
    expect(tags.find((t) => t.id === 2214)?.name).toBe('2d game');
  });
});
