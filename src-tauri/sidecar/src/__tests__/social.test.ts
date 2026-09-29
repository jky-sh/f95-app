import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserClient } from 'browser-rest-api';
import { SocialClient } from '../domain/social/client';
import { forgetCsrf } from '../domain/f95/pages';
import { RPC_ERROR, RpcError } from '../rpc';

type Reply = { status: number; body: string };
type Call = { method: 'GET' | 'POST'; url: string; opts?: { body?: string; query?: Record<string, unknown> } };

/** Minimal BrowserClient double: routes by URL substring, records calls. */
function fakeHttp(routes: Array<[string, (call: Call) => Reply]>) {
  const calls: Call[] = [];
  const handle = async (call: Call) => {
    calls.push(call);
    const route = routes.find(([needle]) => call.url.includes(needle));
    if (!route) throw new Error(`unexpected ${call.method} ${call.url}`);
    const reply = route[1](call);
    return { url: call.url, headers: {}, cookies: [], ...reply };
  };
  const http = {
    get: (url: string, opts?: Call['opts']) => handle({ method: 'GET', url, opts }),
    post: (url: string, opts?: Call['opts']) => handle({ method: 'POST', url, opts }),
  };
  return { http: http as unknown as BrowserClient, calls };
}

const followButton = (label: 'Follow' | 'Unfollow') =>
  `<a href="/members/bob.42/follow" class="button" data-sk-follow="Follow" data-sk-unfollow="Unfollow"><span class="button-text">${label}</span></a>`;

const memberPage = (label: 'Follow' | 'Unfollow', csrf = 'tok-page') =>
  `<html data-csrf="${csrf}"><body><a class="p-navgroup-link p-navgroup-link--user">me</a>
   <div class="p-body-pageContent"><div class="memberHeader"><h1 class="memberHeader-name"><span class="username">Bob</span></h1>
   <div class="memberHeader-buttons">${followButton(label)}</div></div></div></body></html>`;

const tooltip = (label: 'Follow' | 'Unfollow') =>
  JSON.stringify({
    status: 'ok',
    html: {
      content: `<div class="memberTooltip"><h4 class="memberTooltip-name"><a class="username">Bob</a></h4>
        <dl class="pairs pairs--inline"><dt>Last seen</dt><dd><time data-time="1790707081">Today</time></dd></dl>
        <div class="memberTooltip-actions">${followButton(label)}</div></div>`,
    },
  });

beforeEach(() => forgetCsrf());

describe('SocialClient.setMemberFollow', () => {
  it('does not post when the member is already in the requested state', async () => {
    const { http, calls } = fakeHttp([['/members/42/', () => ({ status: 200, body: memberPage('Unfollow') })]]);
    await expect(new SocialClient(http).setMemberFollow('42', true)).resolves.toEqual({ following: true });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('posts the toggle with the page token and confirms from the tooltip', async () => {
    const { http, calls } = fakeHttp([
      ['/members/42/follow', () => ({ status: 200, body: JSON.stringify({ status: 'ok' }) })],
      ['/members/42/tooltip', () => ({ status: 200, body: tooltip('Follow') })],
      ['/members/42/', () => ({ status: 200, body: memberPage('Unfollow') })],
    ]);
    await expect(new SocialClient(http).setMemberFollow('42', false)).resolves.toEqual({ following: false });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('https://f95zone.to/members/42/follow');
    expect(new URLSearchParams(post?.opts?.body).get('_xfToken')).toBe('tok-page');
  });

  it('surfaces XenForo errors', async () => {
    const { http } = fakeHttp([
      ['/members/42/follow', () => ({ status: 200, body: JSON.stringify({ status: 'error', errors: ['You may not follow this member.'] }) })],
      ['/members/42/', () => ({ status: 200, body: memberPage('Follow') })],
    ]);
    await expect(new SocialClient(http).setMemberFollow('42', true)).rejects.toThrow('You may not follow this member.');
  });

  it('reports a logged-out session', async () => {
    const { http } = fakeHttp([['/members/42/', () => ({ status: 403, body: '<html><body>Log in</body></html>' })]]);
    const err = await new SocialClient(http).setMemberFollow('42', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RPC_ERROR.NOT_INITIALIZED);
  });
});

describe('SocialClient.getMemberCards', () => {
  it('refreshes a stale CSRF token once and retries', async () => {
    let accountHits = 0;
    const { http, calls } = fakeHttp([
      ['/account/', () => {
        accountHits++;
        return { status: 200, body: `<html data-csrf="tok-${accountHits}"><body></body></html>` };
      }],
      ['/members/42/tooltip', (call) =>
        call.opts?.query?._xfToken === 'tok-2'
          ? { status: 200, body: tooltip('Unfollow') }
          : { status: 400, body: JSON.stringify({ status: 'error', errors: ['Security error'] }) }],
    ]);
    const cards = await new SocialClient(http).getMemberCards(['42', '42']);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ userId: '42', username: 'Bob', lastSeenTs: 1790707081000, followState: 'following' });
    expect(accountHits).toBe(2);
    expect(calls.filter((c) => c.url.includes('tooltip'))).toHaveLength(2);
  });

  it('skips members whose tooltip fails', async () => {
    const { http } = fakeHttp([
      ['/account/', () => ({ status: 200, body: '<html data-csrf="tok"><body></body></html>' })],
      ['/members/1/tooltip', () => ({ status: 200, body: tooltip('Follow') })],
      ['/members/2/tooltip', () => ({ status: 404, body: '' })],
    ]);
    const cards = await new SocialClient(http).getMemberCards(['1', '2']);
    expect(cards.map((c) => c.userId)).toEqual(['1']);
  });
});
