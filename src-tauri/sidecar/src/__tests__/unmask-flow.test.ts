import { describe, expect, it } from 'vitest';
import type { BrowserClient } from 'browser-rest-api';
import { unmaskUrl } from '../domain/f95/unmask';
import { f95SessionCookies } from '../domain/f95/session';
import { RPC_ERROR, RpcError } from '../rpc';

// unmaskUrl over a fake client that answers like F95's /dl/ pages (markup as
// seen live in October 2026, values made up).
const PAGE_URL =
  'https://f95zone.to/dl/5617588/?u=123456&k=aB1cD2eF3gH4&r=1792560000&t=Zm9vYmFyYmF6cXV4MTIz';
const FRESH_URL =
  'https://f95zone.to/dl/5617588/?u=123456&k=aB1cD2eF3gH4&r=1792570000&t=bmV3c2lnbmF0dXJlMTIz';
const CODE = 'Xy7-q9_Lm2';
const hide = (code: string) => 'c' + Buffer.from(code.split('').reverse().join(''), 'latin1').toString('base64');
const attr = (url: string) => url.replace(/&/g, '&amp;');

const downloadPage = (url: string, check = false) => `<html data-logged-in="true"><body><div class="p-body-pageContent">
  <div class="f95dl-page f95dl-page--side" data-xf-init="f95dl-page" data-auto="0" data-code="${hide(CODE)}">
    <form action="${attr(new URL(url).pathname + new URL(url).search)}" method="post" class="block f95dl-box">
      <input type="hidden" name="had_check" value="${check ? 1 : 0}">
      <input type="hidden" name="w" value="" class="js-f95dlCode">
      ${check ? '<div class="f95dl-check-box" data-xf-init="f95dl-hcaptcha" data-sitekey="x"></div>' : ''}
      <button type="submit" class="button button--primary f95dl-continue js-f95dlContinue"><span class="button-text">Continue to pixeldrain.com</span></button>
      <input type="hidden" name="_xfToken" value="1792560000,fake-token">
    </form>
  </div></div></body></html>`;
const goPage = `<html><body><main class="f95dl-shell-main"><div class="f95dl-page">
  <div class="blockMessage f95dl-going" data-xf-init="f95dl-go" data-url="https://pixeldrain.com/u/AbCd1234" role="status"></div>
  </div></main></body></html>`;
const expiredPage = `<html data-logged-in="true"><body><div class="p-body-pageContent"><div class="blockMessage">
  This download link has expired: they work for a few hours after the page was opened. Please open it again from the post.
  </div></div></body></html>`;
const postPage = `<html data-logged-in="true"><body>
  <article class="message" data-content="post-5617588"><div class="bbWrapper">
    <span class="u-hidden"><a href="${attr(PAGE_URL.replace('aB1cD2eF3gH4', 'zzzzzzzzzzzz'))}" tabindex="-1">PIXELDRAIN</a></span>
    <a href="${attr(FRESH_URL)}">PIXELDRAIN</a>
  </div></article></body></html>`;

interface Call {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
  at: number;
}

function fakeClient(pages: Record<string, string>): { http: BrowserClient; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (method: Call['method'], url: string, body?: string) => {
    calls.push({ method, url, body, at: Date.now() });
    const key = `${method} ${url}`;
    if (!(key in pages)) throw new Error(`unexpected ${key}`);
    return Promise.resolve({ status: 200, url, headers: {}, body: pages[key] });
  };
  const http = {
    get: (url: string) => answer('GET', url),
    post: (url: string, opts: { body?: string }) => answer('POST', url, opts.body),
  } as unknown as BrowserClient;
  return { http, calls };
}

describe('unmaskUrl on /dl/ pages', () => {
  it('posts the decoded code after the delay and returns the host URL', async () => {
    const { http, calls } = fakeClient({
      [`GET ${PAGE_URL}`]: downloadPage(PAGE_URL),
      [`POST ${PAGE_URL}`]: goPage,
    });
    expect(await unmaskUrl(http, PAGE_URL)).toEqual({ url: 'https://pixeldrain.com/u/AbCd1234', status: 200 });
    const [get, post] = calls;
    expect(post.at - get.at).toBeGreaterThanOrEqual(2000);
    expect(Object.fromEntries(new URLSearchParams(post.body))).toEqual({
      had_check: '0',
      w: CODE,
      _xfToken: '1792560000,fake-token',
    });
  });

  it('signs an expired link again from its post, skipping the hidden decoy', async () => {
    const { http, calls } = fakeClient({
      [`GET ${PAGE_URL}`]: expiredPage,
      ['GET https://f95zone.to/posts/5617588/']: postPage,
      [`GET ${FRESH_URL}`]: downloadPage(FRESH_URL),
      [`POST ${FRESH_URL}`]: goPage,
    });
    expect((await unmaskUrl(http, PAGE_URL)).url).toBe('https://pixeldrain.com/u/AbCd1234');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${PAGE_URL}`,
      'GET https://f95zone.to/posts/5617588/',
      `GET ${FRESH_URL}`,
      `POST ${FRESH_URL}`,
    ]);
  });

  it('returns the page for a person to pass the hCaptcha, without posting', async () => {
    const { http, calls } = fakeClient({ [`GET ${PAGE_URL}`]: downloadPage(PAGE_URL, true) });
    expect(await unmaskUrl(http, PAGE_URL)).toEqual({ url: PAGE_URL, status: 200, check: true });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('returns the fresh page when the hCaptcha shows after an expired link', async () => {
    const { http } = fakeClient({
      [`GET ${PAGE_URL}`]: expiredPage,
      ['GET https://f95zone.to/posts/5617588/']: postPage,
      [`GET ${FRESH_URL}`]: downloadPage(FRESH_URL, true),
    });
    expect(await unmaskUrl(http, PAGE_URL)).toEqual({ url: FRESH_URL, status: 200, check: true });
  });
});

describe('f95SessionCookies', () => {
  it('hands over the xf_ sign-in cookies only', async () => {
    const expires = new Date('2027-10-19T23:48:09Z');
    const http = {
      ready: Promise.resolve(),
      jar: {
        getCookies: async (url: string) => {
          expect(url).toBe('https://f95zone.to/');
          return [
            { key: 'xf_user', value: '123456%2Cfake', domain: 'f95zone.to', path: '/', expires, secure: true, httpOnly: true },
            { key: 'xf_session', value: 'fake-session', domain: 'f95zone.to', path: '/', expires: 'Infinity', secure: true, httpOnly: true },
            { key: 'cf_clearance', value: 'fake-clearance', domain: '.f95zone.to', path: '/', secure: true, httpOnly: true },
          ];
        },
      },
    } as unknown as BrowserClient;
    expect(await f95SessionCookies(http)).toEqual([
      { name: 'xf_user', value: '123456%2Cfake', domain: 'f95zone.to', path: '/', expires: Math.floor(expires.getTime() / 1000), secure: true, httpOnly: true },
      { name: 'xf_session', value: 'fake-session', domain: 'f95zone.to', path: '/', expires: null, secure: true, httpOnly: true },
    ]);
  });
});
