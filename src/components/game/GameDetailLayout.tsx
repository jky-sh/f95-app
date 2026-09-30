import { Link } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { GameDetailSkeleton } from '../ui/GameDetailSkeleton';
import '../../styles/game-description.css';

/* ── Back navigation ───────────────────────────────────────────────────── */

interface BackBarProps {
  onBack: () => void;
  breadcrumbTo: string;
  breadcrumbLabel: string;
}

export function GameDetailBackBar({
  onBack,
  breadcrumbTo,
  breadcrumbLabel,
}: BackBarProps) {
  const { t } = useT();
  return (
    <div className="game-detail-backbar">
      <button type="button" onClick={onBack} className="game-detail-backbtn">
        {t('common.back')}
      </button>
      <span className="game-detail-breadcrumb-sep">/</span>
      <Link to={breadcrumbTo} className="game-detail-breadcrumb">
        {breadcrumbLabel}
      </Link>
    </div>
  );
}

/* ── Hero (banner + title block) ───────────────────────────────────────── */

interface HeroProps {
  bannerUrl: string | null;
  coverUrl?: string | null;
  badges?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export function GameDetailHero({
  bannerUrl,
  coverUrl,
  badges,
  title,
  meta,
  actions,
}: HeroProps) {
  const art = coverUrl ?? bannerUrl;
  return (
    <div className="game-detail-hero">
      <div className="game-detail-hero-banner">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt=""
            className="game-detail-hero-banner-img"
            decoding="async"
            loading="eager"
          />
        ) : (
          <div className="game-detail-hero-banner-fallback" />
        )}
        <div className="game-detail-hero-banner-gradient" />
      </div>

      <div className="game-detail-hero-body">
        <div className="game-detail-hero-main">
          {art && (
            <div className="game-detail-cover">
              <img
                src={art}
                alt=""
                className="game-detail-cover-img"
                decoding="async"
                loading="eager"
              />
            </div>
          )}
          <div className="game-detail-hero-text">
            {badges && <div className="game-detail-badges">{badges}</div>}
            <h1 className="game-detail-title">{title}</h1>
            {meta && <div className="game-detail-meta">{meta}</div>}
          </div>
        </div>
        {actions && <div className="game-detail-actions">{actions}</div>}
      </div>
    </div>
  );
}

/* ── Layout grid ───────────────────────────────────────────────────────── */

export function GameDetailShell({
  children,
  onContextMenu,
}: {
  children: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="game-detail-page" onContextMenu={onContextMenu}>
      {children}
    </div>
  );
}

export function GameDetailBody({ children }: { children: React.ReactNode }) {
  return <div className="game-detail-body">{children}</div>;
}

export function GameDetailMain({ children }: { children: React.ReactNode }) {
  return <main className="game-detail-main">{children}</main>;
}

export function GameDetailAside({ children }: { children: React.ReactNode }) {
  return <aside className="game-detail-aside">{children}</aside>;
}

export function GameDetailSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`game-detail-section${className ? ` ${className}` : ''}`}>
      <h2 className="game-detail-section-title">{title}</h2>
      {children}
    </section>
  );
}

/* ── Stat chips (hero meta row) ────────────────────────────────────────── */

export function GameDetailChip({
  children,
  accent,
  title,
  className,
}: {
  children: React.ReactNode;
  accent?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`game-detail-chip${accent ? ' game-detail-chip-accent' : ''}${
        className ? ` ${className}` : ''
      }`}
      title={title}
    >
      {children}
    </span>
  );
}

export function GameDetailStatGrid({ children }: { children: React.ReactNode }) {
  return <div className="game-detail-stat-grid">{children}</div>;
}

export function GameDetailStat({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`game-detail-stat${highlight ? ' game-detail-stat-highlight' : ''}${
        className ? ` ${className}` : ''
      }`}
    >
      <span className="game-detail-stat-label">{label}</span>
      <span className="game-detail-stat-value">{value}</span>
    </div>
  );
}

/* ── Fields list (sidebar info) ────────────────────────────────────────── */

export function GameDetailFields({ children }: { children: React.ReactNode }) {
  return <dl className="game-detail-fields">{children}</dl>;
}

export function GameDetailField({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="game-detail-field">
      <dt className="game-detail-field-key">{label}</dt>
      <dd className="game-detail-field-val">
        <span className="game-detail-field-text">{value}</span>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="game-detail-field-action">
            {actionLabel}
          </button>
        )}
      </dd>
    </div>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

export function GameDetailBtnPrimary({
  children,
  onClick,
  disabled,
  title,
  as: Tag = 'button',
  to,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  as?: 'button' | 'a';
  to?: string;
  className?: string;
}) {
  const cls = `game-detail-btn game-detail-btn-primary${className ? ` ${className}` : ''}`;
  if (Tag === 'a' && to) {
    return (
      <Link to={to} className={cls} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function GameDetailBtnSecondary({
  children,
  onClick,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`game-detail-btn game-detail-btn-secondary${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function GameDetailBtnDanger({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="game-detail-btn game-detail-btn-danger"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function GameDetailActionList({ children }: { children: React.ReactNode }) {
  return <div className="game-detail-action-list">{children}</div>;
}

export function GameDetailActionItem({
  children,
  onClick,
  disabled,
  title,
  to,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  to?: string;
  danger?: boolean;
}) {
  const cls = `game-detail-action-item${danger ? ' game-detail-action-item-danger' : ''}`;
  if (to) {
    return (
      <Link to={to} className={cls} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

/* ── Prefix pills (F95 labels) ─────────────────────────────────────────── */

export function PrefixPill({ name, cssClass }: { name: string; cssClass: string | null }) {
  const m = cssClass?.match(/label--(\w+)/);
  const color = m ? labelColorFor(m[1]) : 'var(--text-faint)';
  return (
    <span className="game-detail-prefix" style={{ background: color }}>
      {name}
    </span>
  );
}

function labelColorFor(name: string): string {
  const map: Record<string, string> = {
    olive: '#a08a3a',
    red: 'var(--accent-strong)',
    green: 'var(--status-success)',
    blue: 'var(--status-info)',
    yellow: 'var(--status-warning)',
    orange: '#d97a3a',
    purple: 'var(--status-purple)',
    gray: 'var(--text-faint)',
    accent: 'var(--accent)',
  };
  return map[name.toLowerCase()] ?? 'var(--text-faint)';
}

/* ── States ────────────────────────────────────────────────────────────── */

export function GameDetailLoading() {
  return <GameDetailSkeleton />;
}

export function GameDetailError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div className="game-detail-error" role="alert">
      <strong>{t('gamedetail.error')}</strong>
      <div style={{ marginTop: 6 }}>{message}</div>
      {onRetry && (
        <button type="button" className="store-retry-btn game-detail-error-retry" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function GameDetailTagList({ children }: { children: React.ReactNode }) {
  return <div className="game-detail-tags">{children}</div>;
}

export function GameDetailTag({ children }: { children: React.ReactNode }) {
  return <span className="game-detail-tag">{children}</span>;
}
