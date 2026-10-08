import { useState } from 'react';
import { Plus, Trash, X } from '@phosphor-icons/react';
import { biasGroup, type PhraseBiasGroup } from '@novelwriter/core';
import { t } from '../../i18n.ts';
import { Checkbox, EnterInput, Select } from '../../components/ui.tsx';

/** Theme intensity colour for a bias strength: low / mid / high (the theme's "Intensity" colours). */
export function intensityColor(bias: number): string {
  const a = Math.abs(bias);
  return a === 0 ? 'transparent' : a <= 0.5 ? 'var(--low-intensity)' : a <= 1 ? 'var(--mid-intensity)' : 'var(--high-intensity)';
}

/** Phrase bias groups editor (story-level, lore entries, categories). */
export function PhraseBiasEditor({ groups, onChange, showWhenInactive }: { groups: PhraseBiasGroup[]; onChange: (g: PhraseBiasGroup[]) => void; showWhenInactive?: boolean }) {
  const list = groups.length ? groups : [biasGroup()];
  const [sel, setSel] = useState(0);
  const idx = Math.min(sel, list.length - 1);
  const g = list[idx];
  const patch = (p: Partial<PhraseBiasGroup>) => onChange(list.map((x, i) => (i === idx ? { ...x, ...p } : x)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ gap: 4 }}>
        <Select
          value={String(idx)}
          ariaLabel={t('Phrase Bias')}
          onChange={(v) => setSel(Number(v))}
          options={list.map((x, i) => ({
            value: String(i),
            label: (
              <span>
                {t('Bias')} {i} | <i style={{ opacity: 0.6 }}>{x.phrases.length ? x.phrases.slice(0, 3).join(', ') : t('empty')}</i>
              </span>
            ),
          }))}
        />
        <button type="button" className="enter-input-btn" style={{ height: 40 }} aria-label={t('Add')} onClick={() => {
          onChange([...list, biasGroup()]);
          setSel(list.length);
        }}>
          <Plus size={16} weight="bold" />
        </button>
        <button type="button" className="enter-input-btn" style={{ height: 40 }} aria-label={t('Delete')} onClick={() => {
          onChange(list.length > 1 ? list.filter((_, i) => i !== idx) : [biasGroup()]);
          setSel(0);
        }}>
          <Trash size={16} />
        </button>
      </div>
      <div className="desc">{t('Type in the area below, then press enter to save.')}</div>
      <div style={{ border: '1px solid var(--bg0)' }}>
        <EnterInput placeholder={t('Enter the text you want to bias')} onSubmit={(v) => patch({ phrases: [...g.phrases, v] })} />
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row between" style={{ fontSize: 14 }}>
            <span>
              <b>{t('Bias')}:</b> {g.bias}
            </span>
            <span>{t('Default: {v}', { v: 0 })}</span>
          </div>
          <input className="slider" type="range" min={-2} max={2} step={0.01} value={g.bias} onChange={(e) => patch({ bias: parseFloat(e.target.value) })} aria-label={t('Bias')} />
          <div className="row between" style={{ fontSize: 11, opacity: 0.7 }}>
            <span>{t('LESS')}</span>
            {g.bias === 0 && <span className="warning-text">{t('A bias of zero will have no effect.')}</span>}
            <span>{t('MORE')}</span>
          </div>
          <div className="row between" style={{ fontSize: 14, marginTop: 6 }}>
            <b>{t('Tokens')}</b>
            <span className="desc">{t('Click a token to remove it.')}</span>
          </div>
          <div className="chips">
            {g.phrases.map((p, i) => (
              <span key={i} className="key-chip" style={{ boxShadow: `inset 3px 0 0 ${intensityColor(g.bias)}` }}>
                {p}
                <button type="button" aria-label={t('Remove')} onClick={() => patch({ phrases: g.phrases.filter((_, j) => j !== i) })}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <Checkbox on={g.enabled} onChange={(v) => patch({ enabled: v })} label={t('Enabled')} />
          <Checkbox on={g.ensureSequenceFinish} onChange={(v) => patch({ ensureSequenceFinish: v })} label={t('Ensure Completion After Start')} />
          <Checkbox on={g.generateOnce} onChange={(v) => patch({ generateOnce: v })} label={t('Unbias When Generated')} />
          {showWhenInactive && <Checkbox on={g.whenInactive} onChange={(v) => patch({ whenInactive: v })} label={t('When Entry Inactive')} />}
        </div>
      </div>
    </div>
  );
}
