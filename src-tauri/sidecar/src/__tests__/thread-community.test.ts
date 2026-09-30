import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  parseReactions,
  parseThreadCommunity,
  parseThreadPosts,
  parseThreadReviews,
  threadPostsUrl,
  threadReviewsUrl,
} from '../domain/game/community';

const THREAD = 'https://f95zone.to/threads/moonlit-farm-v0-4-lunar-dev.4242/';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function pageNav(current: number, last: number): string {
  const pages = [1, current, last].filter((n, i, a) => a.indexOf(n) === i);
  return `<nav class="pageNavWrapper"><div class="pageNav"><ul class="pageNav-main">${pages
    .map(
      (n) =>
        `<li class="pageNav-page${n === current ? ' pageNav-page--current' : ''}"><a href="/threads/4242/page-${n}">${n}</a></li>`,
    )
    .join('')}</ul></div></nav>`;
}

interface PostSpec {
  id: number;
  number: number;
  author: string;
  userId?: number;
  avatar?: 'image' | 'letter';
  title?: string;
  banners?: string[];
  time: number;
  body: string;
  reactions?: string;
  edited?: number;
  extraClass?: string;
}

function post(p: PostSpec): string {
  const avatar =
    p.avatar === 'letter'
      ? `<a href="/members/x.${p.userId}/" class="avatar avatar--m avatar--default avatar--default--dynamic" data-user-id="${p.userId}" style="background-color: #009688"><span class="avatar-u${p.userId}-m">${p.author.charAt(0)}</span></a>`
      : `<a href="/members/x.${p.userId}/" class="avatar avatar--m" data-user-id="${p.userId}"><img src="/data/avatars/m/0/${p.userId}.jpg?1" alt="${p.author}"></a>`;
  return `<article class="message message--post js-post ${p.extraClass ?? ''}" data-author="${p.author}" data-content="post-${p.id}" id="js-post-${p.id}">
    <div class="message-inner">
      <div class="message-cell message-cell--user"><section class="message-user">
        <div class="message-avatar"><div class="message-avatar-wrapper">${avatar}</div></div>
        <div class="message-userDetails">
          <h4 class="message-name"><a href="/members/x.${p.userId}/" class="username" data-user-id="${p.userId}"><span class="username--style3">${p.author}</span></a></h4>
          <h5 class="userTitle message-userTitle">${p.title ?? 'Member'}</h5>
          ${(p.banners ?? []).map((b) => `<div class="userBanner message-userBanner"><span class="userBanner-before"></span><strong>${b}</strong></div>`).join('')}
        </div>
      </section></div>
      <div class="message-cell message-cell--main"><div class="message-main">
        <header class="message-attribution">
          <div class="message-attribution-main"><a href="/threads/x.4242/post-${p.id}"><time class="u-dt" datetime="2026-09-30T08:24:54-0300" data-time="${p.time}">Today</time></a></div>
          <ul class="message-attribution-opposite">
            <li><a href="/threads/x.4242/post-${p.id}" data-href="/posts/${p.id}/share"><i class="fa-share-alt"></i></a></li>
            <li><a href="/threads/x.4242/post-${p.id}" rel="nofollow"> #${p.number.toLocaleString('en-US')} </a></li>
          </ul>
        </header>
        <div class="message-content"><div class="message-userContent"><article class="message-body js-selectToQuote">
          <div class="bbWrapper">${p.body}</div>
          <div class="samBannerUnit"><div class="samItem"><iframe src="https://ads.example/?1" width="728" height="90"></iframe></div></div>
          <div class="js-selectToQuoteEnd">&nbsp;</div>
        </article></div></div>
        ${p.edited ? `<div class="message-lastEdit">Last edited: <time class="u-dt" data-time="${p.edited}">x</time></div>` : ''}
        <aside class="message-signature"><div class="bbWrapper">My signature, not part of the post</div></aside>
        ${p.reactions ? `<div class="reactionsBar js-reactionsList is-active"><span class="u-srOnly">Reactions:</span><a class="reactionsBar-link" href="/posts/${p.id}/reactions">${p.reactions}</a></div>` : ''}
      </div></div>
    </div>
  </article>`;
}

function threadPage(posts: string, current: number, last: number): string {
  return `<html><body>
    <div class="p-description"><ul class="listInline"><li><span class="u-srOnly">Thread starter</span>
      <a href="/members/lunardev.77/" class="username u-concealed" data-user-id="77">LunarDev</a></li></ul></div>
    ${pageNav(current, last)}
    <div class="block-body">${posts}</div>
  </body></html>`;
}

describe('parseThreadPosts', () => {
  const html = threadPage(
    [
      post({
        id: 5001,
        number: 21,
        author: 'PixelFan',
        userId: 1001,
        time: 1790767494,
        body: `Looks great <img src="${GIF}" class="smilie smilie--sprite" alt=":)" title="Smile :)"> can't wait`,
        reactions: '<bdi>sushi_roll</bdi>',
      }),
      post({
        id: 5002,
        number: 22,
        author: 'Quietus',
        userId: 1002,
        avatar: 'letter',
        title: 'Well-Known Member',
        banners: ['Donor', 'Respected User'],
        time: 1790771321,
        body: `<blockquote class="bbCodeBlock bbCodeBlock--expandable bbCodeBlock--quote">
            <div class="bbCodeBlock-title"><a href="/goto/post?id=5001" class="bbCodeBlock-sourceJump" data-xf-click="attribution">PixelFan said:</a></div>
            <div class="bbCodeBlock-content"><div class="bbCodeBlock-expandContent">Looks great</div><div class="bbCodeBlock-expandLink"><a>Click to expand...</a></div></div>
          </blockquote>It does.<br>
          <div class="bbCodeSpoiler"><button class="bbCodeSpoiler-button"><span class="bbCodeSpoiler-button-title">Ending</span></button>
            <div class="bbCodeSpoiler-content"><div class="bbCodeBlock bbCodeBlock--spoiler">She leaves.</div></div></div>
          <img src="${GIF}" data-src="https://attachments.f95zone.to/2026/09/1_shot.png" class="bbImage" alt="shot.png">
          <a href="/threads/other-game.99/" class="link link--internal" data-xf-init="x">Other game</a>
          <div class="bbMediaWrapper"><iframe src="https://www.youtube.com/embed/abc123"></iframe></div>`,
        reactions: '<bdi>Ana</bdi>, <bdi>Ben</bdi>, <bdi>Cid</bdi> and 12 others',
      }),
      post({
        id: 5003,
        number: 23,
        author: 'LunarDev',
        userId: 77,
        time: 1790772000,
        edited: 1790773000,
        body: 'Patch coming Friday.',
      }),
      post({ id: 5004, number: 24, author: 'Blocked', userId: 1004, time: 1790774000, body: 'hidden', extraClass: 'is-ignored' }),
    ].join(''),
    2,
    3,
  );
  const page = parseThreadPosts(html, 'https://f95zone.to/threads/moonlit.4242/page-2', '4242');

  it('reads the page position and every visible post in thread order', () => {
    expect(page).toMatchObject({ threadId: '4242', page: 2, totalPages: 3 });
    expect(page.posts.map((p) => p.number)).toEqual([21, 22, 23]);
  });

  it('reads the author, avatar, title and banners', () => {
    const [first, second] = page.posts;
    expect(first.author).toMatchObject({
      userId: '1001',
      name: 'PixelFan',
      profileUrl: 'https://f95zone.to/members/x.1001/',
      avatarUrl: 'https://f95zone.to/data/avatars/m/0/1001.jpg?1',
      avatarLetter: null,
      title: 'Member',
    });
    expect(second.author).toMatchObject({ avatarUrl: null, avatarLetter: 'Q', banners: ['Donor', 'Respected User'] });
  });

  it('reads ids, times, edits, reactions and the thread starter', () => {
    const [first, second, third] = page.posts;
    expect(first).toMatchObject({ id: '5001', url: 'https://f95zone.to/posts/5001/', postedAt: 1790767494000, byStarter: false });
    expect(first.reactions).toEqual({ count: 1, names: ['sushi_roll'] });
    expect(second.reactions).toEqual({ count: 15, names: ['Ana', 'Ben', 'Cid'] });
    expect(third).toMatchObject({ byStarter: true, editedAt: 1790773000000 });
  });

  it('cleans the body: no ads or signature, smilies as text, quotes, spoilers, images and links', () => {
    const [first, second] = page.posts;
    expect(first.html).toContain('Looks great :) can');
    expect(first.html).not.toContain('<img');
    for (const p of page.posts) {
      expect(p.html).not.toContain('ads.example');
      expect(p.html).not.toContain('signature');
    }
    const $ = cheerio.load(second.html);
    expect($('blockquote.x-quote cite').text()).toBe('PixelFan said:');
    expect($('blockquote.x-quote').text()).toContain('Looks great');
    expect(second.html).not.toContain('Click to expand');
    expect($('details.x-spoiler summary').text()).toBe('Ending');
    expect($('details.x-spoiler').text()).toContain('She leaves.');
    expect($('img').attr('src')).toBe('https://attachments.f95zone.to/2026/09/1_shot.png');
    expect($('img').attr('loading')).toBe('lazy');
    expect($('a[href="https://f95zone.to/threads/other-game.99/"]').attr('target')).toBe('_blank');
    expect($('iframe')).toHaveLength(0);
    expect($('a[href="https://www.youtube.com/embed/abc123"]')).toHaveLength(1);
  });

  it('leaves the OP out of the first page', () => {
    const first = parseThreadPosts(
      threadPage(
        post({ id: 4000, number: 1, author: 'LunarDev', userId: 77, time: 1, body: 'The game description' }) +
          post({ id: 4001, number: 2, author: 'PixelFan', userId: 1001, time: 2, body: 'First!' }),
        1,
        3,
      ),
      THREAD,
      '4242',
    );
    expect(first.posts.map((p) => p.number)).toEqual([2]);
    expect(first.page).toBe(1);
  });

  it('treats a thread without page navigation as a single page', () => {
    const single = parseThreadPosts('<html><body></body></html>', THREAD, '4242');
    expect(single).toMatchObject({ page: 1, totalPages: 1, posts: [] });
  });
});

describe('parseThreadReviews', () => {
  const review = (id: number, author: string, stars: number, likes: string, letter = false) => `
    <div class="message message--post message--review js-review" data-author="${author}" data-content="review-${id}">
      <div class="contentRow">
        <div class="contentRow-figure">${
          letter
            ? `<a href="/members/x.${id}/" class="avatar avatar--s avatar--default" data-user-id="${id}"><span>${author.charAt(0)}</span></a>`
            : `<a href="/members/x.${id}/" class="avatar avatar--s" data-user-id="${id}"><img src="/data/avatars/s/0/${id}.jpg?2" alt="${author}"></a>`
        }</div>
        <div class="contentRow-main">
          <div class="contentRow-extra"><span class="ratingStars bratr-rating" title="${stars.toFixed(2)} star(s)">
            ${'<span class="ratingStars-star ratingStars-star--full"></span>'.repeat(stars)}<span class="u-srOnly">${stars.toFixed(2)} star(s)</span>
          </span></div>
          <h3 class="contentRow-header"><a href="/members/x.${id}/" class="username" data-user-id="${id}">${author}</a></h3>
          <div class="contentRow-lesser"><article class="message-body"><div class="bbWrapper">Review by ${author}.<br>Solid <b>art</b>.</div></article></div>
          <footer class="message-footer">
            <div class="actionBar-set actionBar-set--internal"><span class="contentRow-muted"><time class="u-dt" data-time="1789911209">Sep 20, 2026</time></span></div>
            ${likes ? `<div class="likesBar js-likeList is-active"><span class="u-srOnly">Likes:</span><a href="/bratr-ratings/${id}/likes">${likes}</a></div>` : ''}
          </footer>
        </div>
      </div>
    </div>`;
  const html = `<html><body>${pageNav(1, 24)}<div class="block-body">
    ${review(901, 'Hammer', 5, '<bdi>Ana</bdi>')}
    ${review(902, 'Rook', 2, '<bdi>Ana</bdi>, <bdi>Ben</bdi> and 1 other person', true)}
    ${review(903, 'Quiet', 3, '')}
  </div></body></html>`;
  const page = parseThreadReviews(html, 'https://f95zone.to/threads/moonlit.4242/br-reviews/', '4242');

  it('reads the reviews with their rating, author, date and likes', () => {
    expect(page).toMatchObject({ threadId: '4242', page: 1, totalPages: 24 });
    expect(page.reviews.map((r) => [r.id, r.rating, r.likes.count])).toEqual([
      ['901', 5, 1],
      ['902', 2, 3],
      ['903', 3, 0],
    ]);
    expect(page.reviews[0].author).toMatchObject({
      userId: '901',
      name: 'Hammer',
      avatarUrl: 'https://f95zone.to/data/avatars/s/0/901.jpg?2',
    });
    expect(page.reviews[1].author).toMatchObject({ avatarUrl: null, avatarLetter: 'R' });
    expect(page.reviews[0].postedAt).toBe(1789911209000);
    expect(page.reviews[0].html).toBe('Review by Hammer.<br>Solid <b>art</b>.');
  });
});

describe('parseThreadCommunity', () => {
  it('reads the thread rating, the review count and the number of pages', () => {
    const $ = cheerio.load(`<html><body>
      <div class="p-title-pageAction"><div class="br-wrapper">
        <select name="rating" class="br-select input" data-initial-rating="3.9"
          data-vote-content="&lt;div data-href=&quot;/threads/x.4242/br-user-rated&quot;&gt;1,234 Votes&lt;/div&gt;"></select>
      </div></div>
      <div class="tabs"><a class="tabs-tab is-active" href="/threads/x.4242/">Discussion</a>
        <a class="tabs-tab" href="/threads/x.4242/br-reviews/">Reviews (462)</a></div>
      ${pageNav(1, 4787)}
    </body></html>`);
    expect(parseThreadCommunity($, THREAD)).toEqual({
      rating: { average: 3.9, votes: 1234 },
      reviewCount: 462,
      discussionPages: 4787,
    });
  });

  it('returns nothing to show for an unrated thread without reviews or pages', () => {
    const $ = cheerio.load('<html><body></body></html>');
    expect(parseThreadCommunity($, THREAD)).toEqual({ rating: null, reviewCount: null, discussionPages: 1 });
  });
});

describe('parseReactions', () => {
  it('counts the names shown plus the others', () => {
    expect(parseReactions('')).toEqual({ count: 0, names: [] });
    expect(parseReactions('Ana')).toEqual({ count: 1, names: ['Ana'] });
    expect(parseReactions('Ana and Ben')).toEqual({ count: 2, names: ['Ana', 'Ben'] });
    expect(parseReactions('Ana, Ben, Cid and 1 other person')).toEqual({ count: 4, names: ['Ana', 'Ben', 'Cid'] });
    expect(parseReactions('Ana, Ben, Cid and 1,203 others')).toEqual({ count: 1206, names: ['Ana', 'Ben', 'Cid'] });
  });
});

describe('thread URLs', () => {
  it('builds post and review page URLs', () => {
    expect(threadPostsUrl('4242', 'last')).toBe('https://f95zone.to/threads/4242/latest');
    expect(threadPostsUrl('4242', 1)).toBe('https://f95zone.to/threads/4242/');
    expect(threadPostsUrl('4242', 7)).toBe('https://f95zone.to/threads/4242/page-7');
    expect(threadReviewsUrl('4242', 1)).toBe('https://f95zone.to/threads/4242/br-reviews/');
    expect(threadReviewsUrl('4242', 3)).toBe('https://f95zone.to/threads/4242/br-reviews/page-3');
  });
});
