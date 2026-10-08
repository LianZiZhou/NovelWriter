import { Plus, Question, Trash } from '@phosphor-icons/react';
import type { Condition } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { t } from '../../i18n.ts';
import { Select } from '../../components/ui.tsx';

type CType = Condition['type'];

const TYPES: { value: CType; label: string }[] = [
  { value: 'true', label: 'True' },
  { value: 'keyword', label: 'Keyword Match' },
  { value: 'loreActive', label: 'Lore Entry Active' },
  { value: 'model', label: 'AI Model' },
  { value: 'storyMode', label: 'Story Mode' },
  { value: 'random', label: 'Random Chance' },
  { value: 'number', label: 'Numeric Comparison' },
  { value: 'string', label: 'String Comparison' },
  { value: 'and', label: 'AND Group' },
  { value: 'or', label: 'OR Group' },
  { value: 'not', label: 'NOT' },
];

function create(type: CType): Condition {
  switch (type) {
    case 'true':
      return { type };
    case 'keyword':
      return { type, key: '' };
    case 'loreActive':
      return { type, entryId: '' };
    case 'model':
      return { type, model: '' };
    case 'storyMode':
      return { type, mode: 'storyteller' };
    case 'random':
      return { type, chance: 50 };
    case 'number':
      return { type, variable: 'currentStep', op: '>=', value: 1 };
    case 'string':
      return { type, variable: 'storyText', op: 'includes', value: '' };
    case 'and':
    case 'or':
      return { type, conditions: [{ type: 'true' }] };
    case 'not':
      return { type, condition: { type: 'true' } };
  }
}

function ConditionRow({ c, onChange, onRemove }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void }) {
  const entries = useStory((s) => s.current?.lorebook.entries ?? []);
  return (
    <div className="cond-row">
      <Select value={c.type} onChange={(v) => onChange(create(v))} options={TYPES.map((x) => ({ value: x.value, label: t(x.label) }))} style={{ width: 190 }} />
      {c.type === 'keyword' && <input className="input" style={{ width: 220 }} placeholder={t('Key (supports /regex/)')} value={c.key} onChange={(e) => onChange({ ...c, key: e.target.value })} />}
      {c.type === 'loreActive' && (
        <Select value={c.entryId || null} placeholder={t('Choose entry')} onChange={(v) => onChange({ ...c, entryId: v })} options={entries.map((e) => ({ value: e.id, label: e.displayName }))} style={{ width: 220 }} />
      )}
      {c.type === 'model' && <input className="input" style={{ width: 220 }} placeholder="model id" value={c.model} onChange={(e) => onChange({ ...c, model: e.target.value })} />}
      {c.type === 'storyMode' && (
        <Select
          value={c.mode}
          onChange={(v) => onChange({ ...c, mode: v })}
          options={[
            { value: 'storyteller', label: t('Storyteller') },
            { value: 'adventure', label: t('Text Adventure') },
          ]}
          style={{ width: 180 }}
        />
      )}
      {c.type === 'random' && (
        <label className="row" style={{ fontSize: 14 }}>
          <input className="input" style={{ width: 80 }} type="number" min={0} max={100} value={c.chance} onChange={(e) => onChange({ ...c, chance: Number(e.target.value) })} />%
        </label>
      )}
      {c.type === 'number' && (
        <>
          <Select
            value={c.variable}
            onChange={(v) => onChange({ ...c, variable: v })}
            options={(['currentStep', 'paragraphCount', 'characterCount'] as const).map((v) => ({ value: v, label: v }))}
            style={{ width: 170 }}
          />
          <Select value={c.op} onChange={(v) => onChange({ ...c, op: v })} options={(['<', '<=', '=', '>=', '>', '!='] as const).map((v) => ({ value: v, label: v }))} style={{ width: 80 }} />
          <input className="input" style={{ width: 100 }} type="number" value={c.value} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} />
        </>
      )}
      {c.type === 'string' && (
        <>
          <Select
            value={c.variable}
            onChange={(v) => onChange({ ...c, variable: v })}
            options={(['storyText', 'memoryText', 'authorsNoteText'] as const).map((v) => ({ value: v, label: v }))}
            style={{ width: 170 }}
          />
          <Select value={c.op} onChange={(v) => onChange({ ...c, op: v })} options={(['equals', 'includes', 'startsWith', 'endsWith'] as const).map((v) => ({ value: v, label: v }))} style={{ width: 130 }} />
          <input className="input" style={{ width: 160 }} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
        </>
      )}
      <span className="grow" />
      <button type="button" className="icon-btn" aria-label={t('Remove')} onClick={onRemove}>
        <Trash size={16} />
      </button>
      {(c.type === 'and' || c.type === 'or') && (
        <div className="cond-nested">
          <ConditionList list={c.conditions} onChange={(l) => onChange({ ...c, conditions: l })} />
        </div>
      )}
      {c.type === 'not' && (
        <div className="cond-nested">
          <ConditionRow c={c.condition} onChange={(x) => onChange({ ...c, condition: x })} onRemove={() => onChange({ ...c, condition: { type: 'true' } })} />
        </div>
      )}
    </div>
  );
}

function ConditionList({ list, onChange }: { list: Condition[]; onChange: (l: Condition[]) => void }) {
  return (
    <>
      {list.map((c, i) => (
        <ConditionRow key={i} c={c} onChange={(x) => onChange(list.map((y, j) => (j === i ? x : y)))} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
      ))}
      <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...list, { type: 'true' }])}>
        <Plus size={12} weight="bold" /> {t('Add Condition')}
      </button>
    </>
  );
}

export function ConditionsEditor({ conditions, onChange }: { conditions: Condition[]; onChange: (c: Condition[]) => void }) {
  return (
    <>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <h3 style={{ color: 'var(--text-headings)', fontSize: 20 }}>{t('Advanced Conditions')}</h3>
          <span title={t('Extra activation rules beyond keys.')} style={{ opacity: 0.6, display: 'inline-flex' }}>
            <Question size={16} />
          </span>
        </div>
        <button type="button" className="btn dark" style={{ border: '1px solid var(--bg1)' }} onClick={() => onChange([...conditions, { type: 'keyword', key: '' }])}>
          <Plus size={12} weight="bold" /> {t('Add Condition')}
        </button>
      </div>
      <div className="cond-box">
        {conditions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 18 }}>{t('No advanced conditions configured. Click "Add Condition" to create one.')}</div>
        ) : (
          conditions.map((c, i) => (
            <ConditionRow key={i} c={c} onChange={(x) => onChange(conditions.map((y, j) => (j === i ? x : y)))} onRemove={() => onChange(conditions.filter((_, j) => j !== i))} />
          ))
        )}
      </div>
      <div style={{ background: 'var(--bg1)', padding: '10px 8px' }}>
        <b>{t('Note')}:</b> {t('Multiple top-level conditions use OR logic. The entry will activate if any condition evaluates to true.')}
      </div>
    </>
  );
}
