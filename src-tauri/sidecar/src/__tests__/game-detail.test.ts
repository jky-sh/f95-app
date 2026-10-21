import { describe, expect, it } from 'vitest';
import { parseThread } from '../domain/game/client';

const URL = 'https://f95zone.to/threads/eternum.93340/';

function thread(opHtml: string): string {
  return `<html><body>
    <div class="p-title-value"><span class="label">Ren'Py</span> Eternum [v0.9.5] [Caribdis]</div>
    <article class="message"><div class="message-body"><div class="bbWrapper">${opHtml}</div></div></article>
  </body></html>`;
}

describe('parseThread changelog', () => {
  it('takes the spoiler after the Changelog label out of the description', () => {
    const detail = parseThread(
      thread(`
        <b>Overview</b>:<br>Story text.<br><br>
        <b>Version</b>: 0.9.5<br>
        <b>Changelog</b>:<br>
        <div class="bbCodeSpoiler">
          <button class="bbCodeSpoiler-button"><span class="bbCodeSpoiler-button-title">Spoiler</span></button>
          <div class="bbCodeSpoiler-content"><div class="bbCodeBlock"><b>v0.9.5</b><br>- New route<br><b>v0.9.0</b><br>- Fixes</div></div>
        </div><br>
        <b>Developer Notes</b>:<br>Thanks!`),
      URL,
    );
    expect(detail.changelogHtml).toContain('New route');
    expect(detail.changelogHtml).toContain('Fixes');
    expect(detail.descriptionHtml).not.toContain('New route');
    expect(detail.descriptionHtml).not.toMatch(/Changelog/);
    expect(detail.descriptionHtml).toContain('Story text.');
    expect(detail.descriptionHtml).toContain('Thanks!');
    expect(detail.fields['Version']).toBe('0.9.5');
  });

  it('reads plain changelog lines up to the next section label', () => {
    const detail = parseThread(
      thread(`
        <b>Changelog</b>:<br>v0.2: added stuff<br>v0.1: <b>first</b> release<br><br>
        <b>Developer Notes</b>: hi`),
      URL,
    );
    expect(detail.changelogHtml).toContain('added stuff');
    expect(detail.changelogHtml).toContain('first');
    expect(detail.changelogHtml).not.toContain('hi');
    expect(detail.descriptionHtml).toContain('hi');
    expect(detail.descriptionHtml).not.toContain('added stuff');
  });

  it('finds a spoiler titled Changelog', () => {
    const detail = parseThread(
      thread(`Intro<br>
        <div class="bbCodeSpoiler">
          <button class="bbCodeSpoiler-button"><span class="bbCodeSpoiler-button-title">Changelog</span></button>
          <div class="bbCodeSpoiler-content">v1.0 out</div>
        </div>`),
      URL,
    );
    expect(detail.changelogHtml).toContain('v1.0 out');
    expect(detail.descriptionHtml).not.toContain('v1.0 out');
  });

  it('is null without a changelog', () => {
    const detail = parseThread(thread(`<b>Overview</b>: just a story`), URL);
    expect(detail.changelogHtml).toBeNull();
    expect(detail.descriptionHtml).toContain('just a story');
  });
});

describe('parseThread download pages', () => {
  // F95's thread markup since October 2026: every host link goes to its
  // /dl/ page and shows the host's favicon as an inline background.
  const dl = (k: string) =>
    `https://f95zone.to/dl/5617588/?u=123456&amp;k=${k}&amp;r=1792560000&amp;t=Zm9vYmFyYmF6cXV4MTIz`;
  const link = (k: string, domain: string | null, label: string) =>
    `<a href="${dl(k)}" class="link link--external has-favicon" target="_blank" rel="nofollow ugc noopener"` +
    (domain ? ` style="background-image: url(&quot;https://external-content.duckduckgo.com/ip3/${domain}.ico&quot;);"` : '') +
    `>${label}</a>`;

  const detail = parseThread(
    thread(`
      <b>Overview</b>: A story.<br>
      <b>DOWNLOAD</b><br>
      <b>Win/Linux</b>: ${link('aaaaaaaaaaaa', 'datanodes.to', 'DATANODES')} - ${link('bbbbbbbbbbbb', 'gofile.io', 'GOFILE')} - ${link('cccccccccccc', null, 'MEGA')}<br>
      <b>Mac</b>: ${link('dddddddddddd', 'pixeldrain.com', 'PIXELDRAIN')} - ${link('eeeeeeeeeeee', 'files.example.net', 'NEWHOST')}`),
    URL,
  );

  it('lists every /dl/ link as a download of the host its favicon names', () => {
    expect(detail.downloads.map((d) => [d.group, d.host, d.text])).toEqual([
      ['Win/Linux', 'datanodes', 'DATANODES'],
      ['Win/Linux', 'gofile', 'GOFILE'],
      ['Win/Linux', 'mega', 'MEGA'],
      ['Mac', 'pixeldrain', 'PIXELDRAIN'],
      ['Mac', 'files.example.net', 'NEWHOST'],
    ]);
    expect(detail.downloads[0].url).toBe(
      'https://f95zone.to/dl/5617588/?u=123456&k=aaaaaaaaaaaa&r=1792560000&t=Zm9vYmFyYmF6cXV4MTIz',
    );
  });

  it('drops the favicon background from the description links', () => {
    expect(detail.descriptionHtml).toContain('DATANODES');
    expect(detail.descriptionHtml).not.toContain('background-image');
    expect(detail.descriptionHtml).not.toContain('style=');
  });
});
