import { CaretDown, CaretUp, X } from '@phosphor-icons/react';
import { t } from '../../i18n.ts';

export function FindBar({ query, index, total, onQuery, onNext, onPrev, onClose }: { query: string; index: number; total: number; onQuery: (q: string) => void; onNext: () => void; onPrev: () => void; onClose: () => void }) {
  return (
    <div className="find-bar fade-in">
      <input
        autoFocus
        className="input"
        style={{ width: 220, padding: '6px 8px' }}
        placeholder={t('Find')}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.shiftKey ? onPrev : onNext)();
          if (e.key === 'Escape') onClose();
        }}
      />
      <span className="muted" style={{ fontSize: 13, minWidth: 48, textAlign: 'center' }}>{query ? `${total ? index + 1 : 0}/${total}` : ''}</span>
      <button type="button" className="icon-btn" onClick={onPrev} aria-label="Previous">
        <CaretUp size={16} />
      </button>
      <button type="button" className="icon-btn" onClick={onNext} aria-label="Next">
        <CaretDown size={16} />
      </button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}>
        <X size={16} />
      </button>
    </div>
  );
}
