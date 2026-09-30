import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from '../game/GameDescription';
import { memberIdFromUrl, memberRoute } from '../../lib/memberLinks';

/**
 * Sanitized F95 BB-code HTML (bio, signature). Links never navigate the
 * app window: member links open the in-app profile, everything else the
 * system browser.
 */
export function MemberBbContent({ html }: { html: string }) {
  const navigate = useNavigate();
  const clean = useMemo(
    () => DOMPurify.sanitize(html, { ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['loading'] }),
    [html],
  );

  function onClick(e: React.MouseEvent) {
    const anchor = (e.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) return;
    e.preventDefault();
    if (!/^https?:/i.test(href)) return;
    const memberId = memberIdFromUrl(href);
    if (memberId) navigate(memberRoute(memberId));
    else void openUrl(href);
  }

  return (
    <div className="member-bb" onClick={onClick}>
      <GameDescription html={clean} />
    </div>
  );
}
