import { describe, expect, it } from 'vitest';
import {
  parseActivityRows,
  parseMemberAbout,
  parseMemberCard,
  parseMemberHeader,
} from '../domain/f95/member';
import { parseFollowingPage } from '../domain/social/client';

// Fixtures mirror F95's XenForo 2 markup (member_view, member_tooltip,
// account_following, member_latest_activity, member_recent_content,
// member_about) with made-up members.

const followButton = (label: 'Follow' | 'Unfollow') =>
  `<a href="/members/alice.1234/follow" class="button--link button" data-xf-click="switch" data-sk-follow="Follow" data-sk-unfollow="Unfollow"><span class="button-text"> ${label} </span></a>`;

const statsHtml = `
  <dl class="pairs pairs--rows pairs--rows--centered fauxBlockLink"><dt>Messages</dt><dd><a href="/search/member?user_id=1234"> 6,917 </a></dd></dl>
  <dl class="pairs pairs--rows pairs--rows--centered"><dt title="Reaction score">Reaction score</dt><dd> 52,650 </dd></dl>
  <dl class="pairs pairs--rows pairs--rows--centered fauxBlockLink"><dt title="Trophy points">Points</dt><dd><a href="/members/alice.1234/trophies"> 1,080 </a></dd></dl>
  <dl class="pairs pairs--rows pairs--rows--centered"><dt title="Ratings Received">Ratings Received</dt><dd> 2,377 </dd></dl>
  <dl class="pairs pairs--rows pairs--rows--centered"><dt title="Donated">Donated</dt><dd> $40.00 </dd></dl>`;

const joinedLastSeenHtml = `
  <dl class="pairs pairs--inline"><dt>Joined</dt><dd><time class="u-dt" data-time="1499288956" data-date-string="Jul 5, 2017" title="Jul 5, 2017 at 6:09 PM">Jul 5, 2017</time></dd></dl>
  <dl class="pairs pairs--inline"><dt>Last seen</dt><dd><time class="u-dt" data-time="1790707081" data-date-string="Sep 29, 2026" title="Sep 29, 2026 at 3:38 PM">Today at 3:38 PM</time></dd></dl>`;

const bannersHtml = `
  <em class="userBanner userBanner--royalBlue"><span class="userBanner-before"></span><strong>Staff member</strong><span class="userBanner-after"></span></em>
  <em class="userBanner Moderator"><strong><i class="fa fa-shield"></i> <strong>Moderator</strong></strong></em>
  <em class="userBanner Donor"><strong>Donor <i class="fa fa-coffee"></i></strong></em>`;

const blurbHtml = `<span class="userTitle">Birb Title</span> <span aria-hidden="true">·</span> From <a href="/misc/location-info?location=Somewhere" class="u-concealed">Somewhere</a>`;

function memberPage(buttons: string): string {
  return `<html><body><div class="memberHeader">
    <div class="memberHeader-main cover cover-user cover-hasImage" style="background-position-y: 50.5%; background-image: url('/data/covers/user/l/1/1234.jpg?111');">
      <span class="memberHeader-avatar"><span class="avatarWrapper"><a href="/data/avatars/o/1/1234.jpg?222" class="avatar avatar--l" data-user-id="1234"><img src="/data/avatars/l/1/1234.jpg?222" alt="Alice" class="avatar-u1234-l"></a></span></span>
      <div class="memberHeader-content memberHeader-content--info">
        <h1 class="memberHeader-name"><span class="username" data-user-id="1234"><span class="username--style34 username--staff username--moderator">Alice</span></span></h1>
        <div class="memberHeader-banners">${bannersHtml}</div>
        <div class="memberHeader-blurb">${blurbHtml}</div>
      </div>
    </div>
    <div class="memberHeader-content">
      <div class="memberHeader-stats"><div class="pairJustifier">${statsHtml}</div></div>
      <div class="uix_memberHeader__extra">
        <div class="memberHeader-blurb">${joinedLastSeenHtml}</div>
        <div class="memberHeader-buttons">${buttons}</div>
      </div>
    </div>
  </div></body></html>`;
}

describe('parseMemberHeader', () => {
  it('reads cover, badges, stats, timestamps and follow state', () => {
    const h = parseMemberHeader(memberPage(`<div class="buttonGroup">${followButton('Unfollow')}</div>`));
    expect(h.avatarUrl).toBe('https://f95zone.to/data/avatars/o/1/1234.jpg?222');
    expect(h.coverUrl).toBe('https://f95zone.to/data/covers/user/l/1/1234.jpg?111');
    expect(h.coverPositionY).toBe(50.5);
    expect(h.banners).toEqual(['Staff member', 'Moderator', 'Donor']);
    expect(h.userBanner).toBe('Staff member');
    expect(h.customTitle).toBe('Birb Title');
    expect(h.location).toBe('Somewhere');
    expect(h.isStaff).toBe(true);
    expect(h.isModerator).toBe(true);
    expect(h.joinedAt).toBe('Jul 5, 2017');
    expect(h.joinedAtTs).toBe(1499288956000);
    expect(h.lastSeen).toBe('Today at 3:38 PM');
    expect(h.lastSeenTs).toBe(1790707081000);
    expect(h.messagesCount).toBe(6917);
    expect(h.reactionScore).toBe(52650);
    expect(h.points).toBe(1080);
    expect(h.trophyPoints).toBe(1080);
    expect(h.ratingsReceived).toBe(2377);
    expect(h.extraStats).toEqual({ Donated: '$40.00' });
    expect(h.followState).toBe('following');
    expect(h.conversationUrl).toBeNull();
  });

  it('detects not-following and the conversation link', () => {
    const h = parseMemberHeader(
      memberPage(
        `<div class="buttonGroup">${followButton('Follow')}</div>` +
          `<a href="/conversations/add?to=Alice" class="button--link button"><span class="button-text">Start conversation</span></a>`,
      ),
    );
    expect(h.followState).toBe('not_following');
    expect(h.conversationUrl).toBe('https://f95zone.to/conversations/add?to=Alice');
  });

  it('has no follow state on the own profile', () => {
    expect(parseMemberHeader(memberPage('')).followState).toBeNull();
  });

  it('returns an empty header when the markup is missing', () => {
    const h = parseMemberHeader('<html><body>nope</body></html>');
    expect(h.avatarUrl).toBeNull();
    expect(h.banners).toEqual([]);
    expect(h.lastSeenTs).toBeNull();
    expect(h.extraStats).toEqual({});
  });
});

describe('parseMemberCard', () => {
  it('parses the tooltip JSON content', () => {
    const html = `<div class="tooltip-content-inner"><div class="memberTooltip">
      <div class="memberTooltip-header cover cover-hasImage" style="background-position-y: 20%; background-image: url('/data/covers/user/m/1/1234.jpg?111');">
        <span class="memberTooltip-avatar"><a href="/members/alice.1234/" class="avatar avatar--m" data-user-id="1234"><img src="/data/avatars/m/1/1234.jpg?222" alt="Alice"></a></span>
        <div class="memberTooltip-headerInfo">
          <h4 class="memberTooltip-name"><a href="/members/alice.1234/" class="username" data-user-id="1234"><span class="username--staff">Alice</span></a></h4>
          <div class="memberTooltip-banners">${bannersHtml}</div>
          <div class="memberTooltip-blurb"><div>${blurbHtml}</div></div>
          <div class="memberTooltip-blurb">${joinedLastSeenHtml}</div>
        </div>
      </div>
      <div class="memberTooltip-info"><div class="memberTooltip-stats"><div class="pairJustifier">${statsHtml}</div></div></div>
      <div class="memberTooltip-actions"><div class="buttonGroup">${followButton('Follow')}</div></div>
    </div></div>`;
    const card = parseMemberCard(html, '1234');
    expect(card.userId).toBe('1234');
    expect(card.username).toBe('Alice');
    expect(card.avatarUrl).toBe('https://f95zone.to/data/avatars/m/1/1234.jpg?222');
    expect(card.coverUrl).toBe('https://f95zone.to/data/covers/user/m/1/1234.jpg?111');
    expect(card.isStaff).toBe(true);
    expect(card.isModerator).toBe(false);
    expect(card.lastSeenTs).toBe(1790707081000);
    expect(card.messagesCount).toBe(6917);
    expect(card.followState).toBe('not_following');
  });
});

describe('parseFollowingPage', () => {
  it('parses member list rows and the last page', () => {
    const html = `<div class="p-body-pageContent"><div class="block"><ol class="block-body">
      <li class="block-row block-row--separated"><div class="contentRow">
        <div class="contentRow-figure"><a href="/members/alice.1234/" class="avatar avatar--s" data-user-id="1234"><img src="/data/avatars/s/1/1234.jpg?1" srcset="/data/avatars/m/1/1234.jpg?1 2x" alt="Alice"></a></div>
        <div class="contentRow-main">
          <div class="contentRow-extra">${followButton('Unfollow')}</div>
          <h3 class="contentRow-header"><a href="/members/alice.1234/" class="username" data-user-id="1234"><span class="username--staff username--moderator">Alice</span></a></h3>
          <div class="contentRow-lesser">${blurbHtml}</div>
          <div class="contentRow-minor"><ul class="listInline listInline--bullet">
            <li><dl class="pairs pairs--inline"><dt>Messages</dt><dd>6,917</dd></dl></li>
            <li><dl class="pairs pairs--inline"><dt>Reaction score</dt><dd>52,650</dd></dl></li>
            <li><dl class="pairs pairs--inline"><dt>Points</dt><dd>1,080</dd></dl></li>
          </ul></div>
        </div>
      </div></li>
    </ol></div>
    <nav class="pageNav"><ul class="pageNav-main"><li class="pageNav-page pageNav-page--current"><a href="/account/following">1</a></li><li class="pageNav-page"><a href="/account/following?page=2">2</a></li><li class="pageNav-page"><a href="/account/following?page=3">3</a></li></ul></nav>
    </div>`;
    const { users, lastPage } = parseFollowingPage(html);
    expect(lastPage).toBe(3);
    expect(users).toEqual([
      {
        userId: '1234',
        username: 'Alice',
        avatarUrl: 'https://f95zone.to/data/avatars/m/1/1234.jpg?1',
        profileUrl: 'https://f95zone.to/members/alice.1234/',
        customTitle: 'Birb Title',
        location: 'Somewhere',
        isStaff: true,
        isModerator: true,
        messagesCount: 6917,
        reactionScore: 52650,
        points: 1080,
      },
    ]);
  });

  it('returns no users for the empty state', () => {
    const html = `<div class="p-body-pageContent"><div class="blockMessage">You are not currently following any members.</div></div>`;
    expect(parseFollowingPage(html)).toEqual({ users: [], lastPage: 1 });
  });
});

describe('parseActivityRows', () => {
  it('parses latest-activity sentences with timestamps', () => {
    const html = `<ol class="block-body">
      <li class="block-row"><div class="contentRow">
        <span class="contentRow-figure"><a href="/members/alice.1234/" class="avatar avatar--s"><img src="/data/avatars/s/1/1234.jpg?1" alt="Alice"></a></span>
        <div class="contentRow-main">
          <div class="contentRow-title"><a href="/members/alice.1234/" class="username">Alice</a> replied to the thread <a href="/posts/555/">Some Game [v1.0]</a>.</div>
          <div class="contentRow-snippet">Thanks for the update!</div>
          <div class="contentRow-minor"><time class="u-dt" data-time="1790706919" data-date-string="Sep 29, 2026">Today at 3:35 PM</time></div>
        </div>
      </div></li>
    </ol>`;
    expect(parseActivityRows(html)).toEqual([
      {
        avatarUrl: 'https://f95zone.to/data/avatars/s/1/1234.jpg?1',
        title: 'Alice replied to the thread Some Game [v1.0].',
        snippet: 'Thanks for the update!',
        date: 'Sep 29, 2026',
        dateTs: 1790706919000,
        url: 'https://f95zone.to/posts/555/',
        meta: null,
      },
    ]);
  });

  it('reads the forum of postings and skips nested rows', () => {
    const html = `<ol class="block-body">
      <li class="block-row"><div class="contentRow">
        <div class="contentRow-main">
          <h3 class="contentRow-title"><a href="/threads/some-game.777/post-555"><span class="pre-readme">README</span><span class="label-append">&nbsp;</span>Some Game</a></h3>
          <div class="contentRow-snippet"><div class="contentRow"><div class="contentRow-title">nested quote</div></div></div>
          <div class="contentRow-minor"><ul class="listInline"><li>Post #105</li><li><time data-time="1790706919" data-date-string="Sep 29, 2026">Today</time></li><li>Forum: <a href="/forums/general-discussions.9/">General Discussions</a></li></ul></div>
        </div>
      </div></li>
    </ol>`;
    const rows = parseActivityRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('README Some Game');
    expect(rows[0].dateTs).toBe(1790706919000);
    expect(rows[0].url).toBe('https://f95zone.to/threads/some-game.777/post-555');
    expect(rows[0].meta).toBe('General Discussions');
  });

  it('keeps thread ratings out of the title', () => {
    const html = `<div class="contentRow"><div class="contentRow-main">
      <h3 class="contentRow-title"><a href="/threads/offtopic.189773/post-1">Offtopic</a> <span class="ratingStarsRow"><span class="ratingStars" title="4.20 star(s)"><span class="u-srOnly">4.20 star(s)</span></span><span class="ratingStarsRow-text"> 13 Votes </span></span></h3>
    </div></div>`;
    const [row] = parseActivityRows(html);
    expect(row.title).toBe('Offtopic');
    expect(row.url).toBe('https://f95zone.to/threads/offtopic.189773/post-1');
  });
});

describe('parseMemberAbout', () => {
  it('splits bio, fields, signature and follow lists', () => {
    const heapUser = (id: string, name: string) =>
      `<li><a href="/members/${name.toLowerCase()}.${id}/" class="avatar avatar--s" data-user-id="${id}"><img src="/data/avatars/s/0/${id}.jpg" srcset="/data/avatars/m/0/${id}.jpg 2x" alt="${name}"></a></li>`;
    const html = `<div class="p-body-pageContent"><div class="block"><div class="block-container"><div class="block-body">
      <div class="block-row block-row--separated"><div class="bbWrapper">Hello <a href="/threads/faq.1/">FAQ</a> <img src="/data/assets/smile.png"></div></div>
      <div class="block-row block-row--separated"><dl class="pairs pairs--columns"><dt>Location</dt><dd><a href="/misc/location-info?location=Somewhere">Somewhere</a></dd></dl></div>
      <div class="block-row block-row--separated"><h4 class="block-textHeader">Signature</h4><div class="bbWrapper"><div class="lbContainer"><div class="lbContainer-zoomer" data-src="x"></div><img src="https://attachments.f95zone.to/sig.png" class="bbImage"></div></div></div>
      <div class="block-row block-row--separated"><h4 class="block-textHeader">Following</h4><ul class="listHeap">${heapUser('1', 'Bob')}${heapUser('2', 'Carol')}</ul><a href="/members/alice.1234/following/" data-xf-click="overlay">... and 14 more.</a></div>
      <div class="block-row block-row--separated"><h4 class="block-textHeader">Followers</h4><ul class="listHeap">${heapUser('3', 'Dan')}${heapUser('4', 'Eve')}</ul><a href="/members/alice.1234/followers/" data-xf-click="overlay">... and 1,535 more.</a></div>
      <div class="block-row block-row--separated"><h4 class="block-textHeader">Trophies</h4></div>
    </div></div></div></div>`;
    const about = parseMemberAbout(html);
    expect(about.bioHtml).toBe(
      'Hello <a href="https://f95zone.to/threads/faq.1/">FAQ</a> <img src="https://f95zone.to/data/assets/smile.png">',
    );
    expect(about.fields).toEqual([{ label: 'Location', value: 'Somewhere' }]);
    expect(about.signatureHtml).toContain('<img src="https://attachments.f95zone.to/sig.png" class="bbImage">');
    expect(about.signatureHtml).not.toContain('lbContainer-zoomer');
    expect(about.following.total).toBe(16);
    expect(about.following.users).toEqual([
      { userId: '1', username: 'Bob', avatarUrl: 'https://f95zone.to/data/avatars/m/0/1.jpg' },
      { userId: '2', username: 'Carol', avatarUrl: 'https://f95zone.to/data/avatars/m/0/2.jpg' },
    ]);
    expect(about.followers.total).toBe(1537);
    expect(about.followers.users.map((u) => u.username)).toEqual(['Dan', 'Eve']);
  });

  it('names letter avatars from the profile slug', () => {
    const html = `<div class="p-body-pageContent">
      <div class="block-row"><h4 class="block-textHeader">Followers</h4><ul class="listHeap"><li><a href="/members/hilu-x.3639344/" class="avatar avatar--s avatar--default avatar--default--dynamic" data-user-id="3639344" style="background-color: #0d47a1"><span class="avatar-u3639344-s">H</span></a></li></ul></div>
    </div>`;
    expect(parseMemberAbout(html).followers.users).toEqual([
      { userId: '3639344', username: 'hilu x', avatarUrl: null },
    ]);
  });

  it('counts small follow lists without a "more" link', () => {
    const html = `<div class="p-body-pageContent">
      <div class="block-row"><h4 class="block-textHeader">Followers</h4><ul class="listHeap"><li><a href="/members/bob.1/" class="avatar" data-user-id="1"><img src="/a.jpg" alt="Bob"></a></li></ul></div>
    </div>`;
    const about = parseMemberAbout(html);
    expect(about.followers).toEqual({
      total: 1,
      users: [{ userId: '1', username: 'Bob', avatarUrl: 'https://f95zone.to/a.jpg' }],
    });
    expect(about.following.total).toBe(0);
    expect(about.bioHtml).toBeNull();
  });
});
