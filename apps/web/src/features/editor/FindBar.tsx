import { useState } from 'react';
import { CaretDown, CaretUp, X } from '@phosphor-icons/react';
import { t } from '../../i18n.ts';
import type { FindState } from './pm.ts';

/** Find (Ctrl+F) and replace, with regex and case options. */
export function FindBar({
  find,
  total,
  onFind,
  onNext,
  onPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: {
  find: FindState;
  total: number;
  onFind: (f: FindState) => void;
  onNext: () => void;
  onPrev: () => void;
  onReplace: (text: string) => void;
  onReplaceAll: (text: string) => void;
  onClose: () => void;
}) {
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const toggle = (k: 'regex' | 'caseSensitive') => onFind({ ...find, [k]: !find[k], index: 0 });
  return (
    <div className="find-bar fade-in">
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="icon-btn find-toggle" onClick={() => setShowReplace(!showReplace)} aria-label={t('Toggle Replace')} aria-expanded={showReplace} title={t('Replace')}>
          {showReplace ? <CaretDown size={14} weight="fill" /> : <CaretUp size={14} weight="fill" style={{ transform: 'rotate(90deg)' }} />}
        </button>
        <input
          autoFocus
          className="input"
          style={{ width: 220, padding: '6px 8px' }}
          placeholder={t('Find')}
          aria-label={t('Find')}
          value={find.query}
          onChange={(e) => onFind({ ...find, query: e.target.value, index: 0 })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.shiftKey ? onPrev : onNext)();
            if (e.key === 'Escape') onClose();
          }}
        />
        <button type="button" className={`find-opt ${find.caseSensitive ? 'on' : ''}`} onClick={() => toggle('caseSensitive')} aria-pressed={!!find.caseSensitive} title={t('Match Case')}>
          Aa
        </button>
        <button type="button" className={`find-opt ${find.regex ? 'on' : ''}`} onClick={() => toggle('regex')} aria-pressed={!!find.regex} title={t('Regular Expression')}>
          .*
        </button>
        <span className="muted" style={{ fontSize: 13, minWidth: 48, textAlign: 'center' }}>{find.query ? `${total ? find.index + 1 : 0}/${total}` : ''}</span>
        <button type="button" className="icon-btn" onClick={onPrev} aria-label={t('Previous')}>
          <CaretUp size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={onNext} aria-label={t('Next')}>
          <CaretDown size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={16} />
        </button>
      </div>
      {showReplace && (
        <div className="row" style={{ gap: 6, marginTop: 6, paddingLeft: 28 }}>
          <input
            className="input"
            style={{ width: 220, padding: '6px 8px' }}
            placeholder={find.regex ? t('Replace ($1 for groups)') : t('Replace')}
            aria-label={t('Replace with')}
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onReplace(replace);
              if (e.key === 'Escape') onClose();
            }}
          />
          <button type="button" className="btn small" disabled={!total} onClick={() => onReplace(replace)}>
            {t('Replace')}
          </button>
          <button type="button" className="btn small" disabled={!total} onClick={() => onReplaceAll(replace)}>
            {t('Replace All')}
          </button>
        </div>
      )}
    </div>
  );
}
