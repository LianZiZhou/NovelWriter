import { Plus, Question, Trash } from '@phosphor-icons/react';
import type { Condition, EquationTerm, EquationVariable } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { t } from '../../i18n.ts';
import { Select } from '../../components/ui.tsx';

type CType = Condition['type'];

const TYPES: { value: CType; label: string; desc: string }[] = [
  { value: 'true', label: 'True', desc: 'Always true.' },
  { value: 'keyword', label: 'Keyword Match', desc: 'True when the key is found in the chosen text.' },
  { value: 'loreActive', label: 'Lore Entry Active', desc: 'True when another lorebook entry is active.' },
  { value: 'model', label: 'AI Model', desc: 'True when the story uses this model id.' },
  { value: 'storyMode', label: 'Story Mode', desc: 'True in the chosen story mode.' },
  { value: 'random', label: 'Random Chance', desc: 'True with the given chance on each generation.' },
  { value: 'number', label: 'Numeric Comparison', desc: 'Compares a story value with a number.' },
  { value: 'equation', label: 'Equation', desc: 'Combines numbers and story values left to right (no operator precedence), then compares the result.' },
  { value: 'string', label: 'String Comparison', desc: 'Compares the story, Memory or Author\'s Note text.' },
  { value: 'and', label: 'AND Group', desc: 'True when every condition inside is true.' },
  { value: 'or', label: 'OR Group', desc: 'True when any condition inside is true.' },
  { value: 'not', label: 'NOT', desc: 'True when the condition inside is false.' },
];

const VARIABLES: { value: EquationVariable; label: string }[] = [
  { value: 'currentStep', label: 'Current Step' },
  { value: 'paragraphCount', label: 'Paragraph Count' },
  { value: 'characterCount', label: 'Character Count' },
  { value: 'activeEntries', label: 'Active Entries' },
  { value: 'random', label: 'Random (0-99)' },
];
const OPS = ['<', '<=', '=', '>=', '>', '!='] as const;

function EquationEditor({ terms, onChange }: { terms: EquationTerm[]; onChange: (t: EquationTerm[]) => void }) {
  const set = (i: number, p: Partial<EquationTerm>) => onChange(terms.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <span className="row equation" style={{ gap: 4, flexWrap: 'wrap' }}>
      {terms.map((term, i) => (
        <span key={i} className="row" style={{ gap: 4 }}>
          {i > 0 && (
            <Select value={term.operator} onChange={(v) => set(i, { operator: v })} options={(['+', '-', '*', '/', '%'] as const).map((v) => ({ value: v, label: v }))} style={{ width: 62 }} ariaLabel={t('Operator')} />
          )}
          <Select
            value={typeof term.value === 'number' ? '__num' : term.value}
            onChange={(v) => set(i, { value: v === '__num' ? 0 : (v as EquationVariable) })}
            options={[{ value: '__num', label: t('Number') }, ...VARIABLES.map((v) => ({ value: v.value, label: t(v.label) }))]}
            style={{ width: 150 }}
            ariaLabel={t('Term')}
          />
          {typeof term.value === 'number' && <input className="input" style={{ width: 70 }} type="number" value={term.value} aria-label={t('Number')} onChange={(e) => set(i, { value: Number(e.target.value) })} />}
          {terms.length > 1 && (
            <button type="button" className="icon-btn" aria-label={t('Remove Term')} onClick={() => onChange(terms.filter((_, j) => j !== i))}>
              <Trash size={14} />
            </button>
          )}
        </span>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...terms, { operator: '+', value: 1 }])}>
        <Plus size={12} weight="bold" /> {t('Term')}
      </button>
    </span>
  );
}

function create(type: CType): Condition {
  switch (type) {
    case 'true':
      return { type };
    case 'keyword':
      return { type, key: '', location: 'story' };
    case 'equation':
      return { type, terms: [{ operator: '+', value: 'currentStep' }, { operator: '%', value: 5 }], op: '=', value: 0 };
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
  const info = TYPES.find((x) => x.value === c.type);
  return (
    <div className="cond-row">
      <span className="row" style={{ gap: 4 }} title={info ? t(info.desc) : undefined}>
        <Select value={c.type} onChange={(v) => onChange(create(v))} options={TYPES.map((x) => ({ value: x.value, label: t(x.label) }))} style={{ width: 190 }} ariaLabel={t('Condition Type')} />
      </span>
      {c.type === 'keyword' && (
        <>
          <input className="input" style={{ width: 200 }} placeholder={t('Key (supports /regex/)')} value={c.key} aria-label={t('Key')} onChange={(e) => onChange({ ...c, key: e.target.value })} />
          <Select
            value={c.location ?? 'story'}
            onChange={(v) => onChange({ ...c, location: v })}
            ariaLabel={t('Search Location')}
            options={[
              { value: 'story', label: t('Story') },
              { value: 'lore', label: t('Active Lorebook Entries') },
              { value: 'authorsNote', label: t("Author's Note") },
              { value: 'memory', label: t('Memory') },
            ]}
            style={{ width: 200 }}
          />
          <label className="row" style={{ fontSize: 13, gap: 4 }} title={t('Characters searched from the end of the text; 0 searches all of it.')}>
            {t('Range')}
            <input className="input" style={{ width: 90 }} type="number" min={0} max={50000} value={c.range ?? 0} onChange={(e) => onChange({ ...c, range: Math.max(0, Math.min(50000, Number(e.target.value))) })} />
          </label>
        </>
      )}
      {c.type === 'equation' && (
        <>
          <EquationEditor terms={c.terms} onChange={(terms) => onChange({ ...c, terms })} />
          <Select value={c.op} onChange={(v) => onChange({ ...c, op: v })} options={OPS.map((v) => ({ value: v, label: v }))} style={{ width: 70 }} ariaLabel={t('Comparison')} />
          <input className="input" style={{ width: 80 }} type="number" value={c.value} aria-label={t('Value')} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} />
        </>
      )}
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
            options={VARIABLES.slice(0, 3).map((v) => ({ value: v.value as 'currentStep', label: t(v.label) }))}
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
            options={[
              { value: 'storyText' as const, label: t('Story') },
              { value: 'memoryText' as const, label: t('Memory') },
              { value: 'authorsNoteText' as const, label: t("Author's Note") },
            ]}
            style={{ width: 170 }}
          />
          <Select
            value={c.op}
            onChange={(v) => onChange({ ...c, op: v })}
            options={[
              { value: 'equals' as const, label: t('equals') },
              { value: 'includes' as const, label: t('includes') },
              { value: 'startsWith' as const, label: t('starts with') },
              { value: 'endsWith' as const, label: t('ends with') },
            ]}
            style={{ width: 130 }}
          />
          <input className="input" style={{ width: 160 }} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
        </>
      )}
      <span className="grow" />
      {info && <span className="cond-desc">{t(info.desc)}</span>}
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
        <b>{t('Note')}:</b> {t('Multiple top-level conditions use OR logic. The entry will activate if any condition evaluates to true.')}{' '}
        {t('Conditions are checked repeatedly as entries activate, up to 30 passes.')}
      </div>
    </>
  );
}
