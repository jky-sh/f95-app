import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useT } from '../../lib/i18n';
import { memberRoute } from '../../lib/memberLinks';
import type { MemberHeaderFields } from '../../types';
import type { MemberAboutDto, MemberFollowList } from '../../types/social';
import { MemberBbContent } from './MemberBbContent';
import { MemberAvatar } from './MemberProfileParts';

interface Props {
  about: MemberAboutDto;
  member: Pick<MemberHeaderFields, 'joinedAt' | 'joinedAtTs' | 'lastSeen' | 'lastSeenTs' | 'extraStats'> & {
    profileUrl: string;
  };
}

/** About tab: bio and signature, profile fields, following and followers. */
export function MemberAboutPanel({ about, member }: Props) {
  const { t, locale } = useT();
  const [showSignature, setShowSignature] = useState(false);
  const exact = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : null;

  const info: [string, string][] = about.fields.map((f) => [f.label, f.value]);
  const joined = exact(member.joinedAtTs) ?? member.joinedAt;
  if (joined) info.push([t('profile.field.joinedAt'), joined]);
  const seen = exact(member.lastSeenTs) ?? member.lastSeen;
  if (seen) info.push([t('profile.field.lastSeen'), seen]);
  info.push(...Object.entries(member.extraStats));

  const base = member.profileUrl.replace(/\/?$/, '/');

  return (
    <div className="member-about-panel">
      <div className="member-about-main">
        <h3 className="member-about-heading">{t('profile.about.bio')}</h3>
        {about.bioHtml ? (
          <MemberBbContent html={about.bioHtml} />
        ) : (
          <p className="member-about-empty">{t('profile.about.noBio')}</p>
        )}
        {about.signatureHtml && (
          <div className="member-signature">
            <button
              type="button"
              className="member-signature-toggle"
              aria-expanded={showSignature}
              onClick={() => setShowSignature((v) => !v)}
            >
              {showSignature ? t('profile.about.hideSignature') : t('profile.about.showSignature')}
            </button>
            {showSignature && <MemberBbContent html={about.signatureHtml} />}
          </div>
        )}
      </div>

      <aside className="member-about-side">
        {info.length > 0 && (
          <div>
            <h3 className="member-about-heading">{t('profile.about.info')}</h3>
            <dl className="member-info-list">
              {info.map(([k, v]) => (
                <div key={k} className="member-info-row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <FollowList title={t('profile.about.following')} list={about.following} moreUrl={`${base}following/`} />
        <FollowList title={t('profile.about.followers')} list={about.followers} moreUrl={`${base}followers/`} />
      </aside>
    </div>
  );
}

function FollowList({ title, list, moreUrl }: { title: string; list: MemberFollowList; moreUrl: string }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  if (list.total === 0) return null;
  const hidden = list.total - list.users.length;

  return (
    <div>
      <div className="member-follow-head">
        <h3 className="member-about-heading">{title}</h3>
        <span className="member-follow-total">{list.total.toLocaleString(locale)}</span>
      </div>
      <div className="member-follow-grid">
        {list.users.map((u) => (
          <button
            key={u.userId}
            type="button"
            className="member-follow-item"
            title={u.username}
            onClick={() => navigate(memberRoute(u.userId))}
          >
            <MemberAvatar src={u.avatarUrl} username={u.username} className="member-follow-avatar" />
          </button>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className="member-follow-item member-follow-more"
            title={t('profile.about.moreOnF95')}
            onClick={() => void openUrl(moreUrl)}
          >
            +{hidden >= 1000 ? `${Math.floor(hidden / 1000)}k` : hidden}
          </button>
        )}
      </div>
    </div>
  );
}
