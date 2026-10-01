import { useEffect, useMemo, useState } from 'react';
import { useT } from '../lib/i18n';
import {
  inferPlatformLabel,
  pickRecommendedFileId,
  sortFilesForGroup,
} from '../lib/platformMatch';
import { formatBytes } from '../types/download';

export interface HostFileChoiceOption {
  id: string;
  fileName: string;
  fileSize: number | null;
  platformLabel: string | null;
}

interface Props {
  open: boolean;
  host: string;
  platformGroup: string | null;
  files: HostFileChoiceOption[];
  recommendedFileId?: string | null;
  onConfirm: (choiceId: string) => void;
  onCancel: () => void;
}

export function HostFileChoiceModal({
  open,
  host,
  platformGroup,
  files,
  recommendedFileId,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useT();

  const sortedFiles = useMemo(
    () => sortFilesForGroup(files, platformGroup),
    [files, platformGroup],
  );

  const defaultId = useMemo(
    () =>
      pickRecommendedFileId(sortedFiles, platformGroup, recommendedFileId),
    [sortedFiles, platformGroup, recommendedFileId],
  );

  const [selectedId, setSelectedId] = useState<string | null>(defaultId);

  useEffect(() => {
    if (open) setSelectedId(defaultId);
  }, [open, defaultId]);

  if (!open || sortedFiles.length === 0) return null;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t('modal.hostFile.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={titleStyle}>{t('modal.hostFile.title')}</h2>
        <p style={descStyle}>
          {t('modal.hostFile.description', { host, count: sortedFiles.length })}
          {platformGroup ? (
            <span style={{ display: 'block', marginTop: 6, opacity: 0.85 }}>
              {t('modal.hostFile.sectionHint', { group: platformGroup })}
            </span>
          ) : null}
        </p>

        <ul style={listStyle}>
          {sortedFiles.map((file) => {
            const selected = file.id === selectedId;
            const tag =
              file.platformLabel ?? inferPlatformLabel(file.fileName);
            const isRecommended =
              defaultId != null && file.id === defaultId && platformGroup != null;
            return (
              <li key={file.id}>
                <button
                  type="button"
                  style={{
                    ...rowStyle,
                    borderColor: selected ? 'var(--accent-strong)' : 'var(--border)',
                    background: selected ? 'rgba(255,80,80,0.08)' : 'transparent',
                  }}
                  onClick={() => setSelectedId(file.id)}
                >
                  <span style={radioStyle}>{selected ? '●' : '○'}</span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span style={nameStyle}>
                      {file.fileName}
                      {isRecommended ? (
                        <span style={badgeStyle}>
                          {t('modal.hostFile.recommended')}
                        </span>
                      ) : null}
                    </span>
                    <span style={metaStyle}>
                      {tag ? `${tag} · ` : ''}
                      {formatBytes(file.fileSize)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div style={actionsStyle}>
          <button type="button" className="dl-action-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="dl-action-btn dl-action-btn-accent"
            disabled={!selectedId}
            onClick={() => selectedId && onConfirm(selectedId)}
          >
            {t('modal.hostFile.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  maxHeight: '85vh',
  overflow: 'auto',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '20px 22px',
};

const titleStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: '1.15rem' };
const descStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: '0.9rem',
  color: 'var(--text-muted)',
  lineHeight: 1.45,
};
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0 0 18px',
  padding: 0,
  display: 'grid',
  gap: 8,
};
const rowStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  border: '1px solid',
  borderRadius: 8,
  cursor: 'pointer',
  color: 'inherit',
};
const radioStyle: React.CSSProperties = { color: 'var(--accent-strong)', marginTop: 2 };
const nameStyle: React.CSSProperties = { display: 'block', fontWeight: 600, wordBreak: 'break-all' };
const badgeStyle: React.CSSProperties = {
  marginLeft: 8,
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--accent-strong)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const metaStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
  marginTop: 4,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
};
