import { describe, expect, it } from 'vitest';
import { SamClient } from '../domain/sam/client';

function clientCapturing(urls: string[]): SamClient {
  const http = {
    get: async (url: string) => {
      urls.push(url);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ status: 'ok', msg: { data: [], count: 0, pagination: { page: 1, total: 1 } } }),
      };
    },
  };
  return new SamClient(http as never);
}

describe('SamClient.list request', () => {
  it('sends the developer and update-date filters', async () => {
    const urls: string[] = [];
    await clientCapturing(urls).list({ category: 'games', creator: ' Caribdis ', date: 7, notags: [130] });
    const params = new URL(urls[0]).searchParams;
    expect(params.get('creator')).toBe('Caribdis');
    expect(params.get('date')).toBe('7');
    expect(params.getAll('notags[]')).toEqual(['130']);
  });

  it('leaves them out when unset', async () => {
    const urls: string[] = [];
    await clientCapturing(urls).list({ category: 'games', creator: '  ', date: 0 });
    const params = new URL(urls[0]).searchParams;
    expect(params.has('creator')).toBe(false);
    expect(params.has('date')).toBe(false);
  });
});
