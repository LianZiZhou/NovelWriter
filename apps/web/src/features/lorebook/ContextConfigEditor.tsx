import type { ContextConfig } from '@novelwriter/core';
import { t } from '../../i18n.ts';
import { NumberField, Select } from '../../components/ui.tsx';

/** Edit prefix/suffix/budget/reserved/order/position/trim settings. */
export function ContextConfigEditor({ value, onChange }: { value: ContextConfig; onChange: (c: ContextConfig) => void }) {
  const set = (p: Partial<ContextConfig>) => onChange({ ...value, ...p });
  const trimTypes = [
    { value: 'newline' as const, label: t('Newline') },
    { value: 'sentence' as const, label: t('Sentence') },
    { value: 'token' as const, label: t('Token') },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="placement-grid">
        <label className="number-field">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Prefix')}</span>
          <input className="input" value={JSON.stringify(value.prefix).slice(1, -1)} onChange={(e) => set({ prefix: unescape(e.target.value) })} />
        </label>
        <label className="number-field">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Suffix')}</span>
          <input className="input" value={JSON.stringify(value.suffix).slice(1, -1)} onChange={(e) => set({ suffix: unescape(e.target.value) })} />
        </label>
        <NumberField label={t('Token Budget')} value={value.tokenBudget} step={1} min={0} onChange={(v) => set({ tokenBudget: v })} help={t('Maximum tokens. Values from 0 to 1 are a fraction of the context size.')} />
        <NumberField label={t('Reserved Tokens')} value={value.reservedTokens} step={1} min={0} onChange={(v) => set({ reservedTokens: v })} help={t('Tokens set aside before other entries are placed.')} />
        <NumberField label={t('Insertion Order')} value={value.budgetPriority} step={1} onChange={(v) => set({ budgetPriority: v })} help={t('Higher values reserve tokens and are inserted first.')} />
        <NumberField label={t('Insertion Position')} value={value.insertionPosition} step={1} onChange={(v) => set({ insertionPosition: v })} help={t('0 is the top; -1 is the bottom. Counted in insertion-type units.')} />
      </div>
      <div className="placement-grid">
        <div className="number-field">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Trim Direction')}</span>
          <Select
            value={value.trimDirection}
            onChange={(v) => set({ trimDirection: v })}
            options={[
              { value: 'trimTop', label: t('Trim Top') },
              { value: 'trimBottom', label: t('Trim Bottom') },
              { value: 'doNotTrim', label: t('Do Not Trim') },
            ]}
          />
        </div>
        <div className="number-field">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Maximum Trim Type')}</span>
          <Select value={value.maximumTrimType} onChange={(v) => set({ maximumTrimType: v })} options={trimTypes} />
        </div>
        <div className="number-field">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Insertion Type')}</span>
          <Select value={value.insertionType} onChange={(v) => set({ insertionType: v })} options={trimTypes} />
        </div>
      </div>
    </div>
  );
}

/** Interpret \n and \t escapes typed into prefix/suffix fields. */
function unescape(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
