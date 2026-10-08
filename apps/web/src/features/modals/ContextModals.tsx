import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, CornersOut, Plus, Trash } from '@phosphor-icons/react';
import { countTokens, outputTokens, DEFAULT_SYSTEM_PROMPT_ADVENTURE, DEFAULT_SYSTEM_PROMPT_STORY, defaultContextSettings, formatEphemeral, parseEphemeral, ephemeralActive, type BuiltContext, type StoryContextSettings } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { useSettings } from '../../store/settings.ts';
import { t } from '../../i18n.ts';
import { Modal, ModalHeader, Tabs, Toggle } from '../../components/ui.tsx';
import { ContextBar, KIND_COLORS, KIND_LABELS } from '../right/AdvancedTab.tsx';
import { ContextConfigEditor } from '../lorebook/ContextConfigEditor.tsx';

const REASONS: Record<string, string> = {
  included: 'Included',
  trimmed: 'Trimmed to fit',
  budgetExceeded: 'Over budget',
  noSpace: 'No space left',
  empty: 'Empty',
  notActivated: 'Not activated',
  disabled: 'Disabled',
};

export function ContextViewerModal({ onClose, which: initial }: { onClose: () => void; which: 'last' | 'current' }) {
  const last = useStory((s) => s.lastContext);
  const story = useStory((s) => s.current);
  const [which, setWhich] = useState(initial);
  const ctx = useMemo<BuiltContext | null>(() => (which === 'last' ? last : useStory.getState().previewContext()), [which, last]);
  const [stage, setStage] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const colors = useSettings((s) => s.contextViewerColors);
  const tabs = (
    <div className="ctx-tabs" role="tablist">
      {(['last', 'current'] as const).map((w) => (
        <button
          type="button"
          role="tab"
          key={w}
          aria-selected={which === w}
          className={which === w ? 'active' : ''}
          onClick={() => {
            setWhich(w);
            setStage(null);
          }}
        >
          {w === 'last' ? t('Last Context') : t('Current Context')}
        </button>
      ))}
    </div>
  );
  if (!ctx) {
    return (
      <Modal onClose={onClose} width={1000} label={t('Context Viewer')} className="ctx-modal">
        <div className="ctx-modal-head">
          <ModalHeader plain title={t('Context Viewer')} onClose={onClose} />
        </div>
        <div className="modal-body ctx-modal-body">
          {tabs}
          <div className="muted" style={{ padding: '20px 0' }}>{t('No context yet. Send a generation first.')}</div>
        </div>
      </Modal>
    );
  }
  const stageCount = ctx.stages.length;
  const stageIdx = stage ?? stageCount - 1;
  const segments = stage === null ? ctx.segments : ctx.stages[stage] ?? ctx.segments;
  const stageTokens = segments.reduce((n, sg) => n + countTokens(sg.text), 0);
  const reserved = ctx.report.filter((r) => r.included && (r.stage ?? 0) > stageIdx).reduce((n, r) => n + r.reservedTokens, 0);
  const hidden = new Set(ctx.report.filter((r) => r.hidden).map((r) => r.id));
  const rows = ctx.report.filter((r) => showInactive || r.included || r.kind !== 'lore');
  const out = story ? outputTokens(story.params) : 0;
  return (
    <Modal onClose={onClose} width={1000} height="calc(100vh - 50px)" label={t('Context Viewer')} className="ctx-modal">
      <div className="ctx-modal-head">
        <ModalHeader plain title={t('Context Viewer')} onClose={onClose} />
      </div>
      <div className="modal-body ctx-modal-body">
        {tabs}
        <div className="ctx-summary">
          {t('{n} tokens filled out of a maximum of {m}', { n: ctx.usedTokens, m: ctx.maxTokens })} ({t('context size')} [{ctx.maxTokens + out}] - {t('output length')} [{out}])
        </div>
        <ContextBar ctx={ctx} />
        <div className="ctx-legend">
          {(Object.keys(KIND_COLORS) as (keyof typeof KIND_COLORS)[]).map((k) => (
            <span key={k}>
              <i style={{ background: KIND_COLORS[k] }} /> {t(KIND_LABELS[k])}
            </span>
          ))}
        </div>
        <div className="row ctx-stage-row">
          <button type="button" className="btn" disabled={stageIdx <= 0 || stageCount === 0} onClick={() => setStage(Math.max(0, stageIdx - 1))}>
            <CaretLeft size={14} /> {t('Previous Stage')}
          </button>
          <button type="button" className="btn" disabled={stage === null} onClick={() => setStage(stageIdx + 1 >= stageCount - 1 ? null : stageIdx + 1)}>
            {t('Next Stage')} <CaretRight size={14} />
          </button>
          <span>
            {t('Stage {a}/{b}, Reserved: {r}, Remaining: {n}', { a: stageIdx, b: Math.max(0, stageCount - 1), r: reserved, n: Math.max(0, ctx.maxTokens - stageTokens - reserved) })}
          </span>
        </div>
        <div className="ctx-stage-note">
          {stage === null || stageIdx >= stageCount - 1
            ? t('Final context, as sent to the AI.')
            : stageIdx === 0
              ? t('Stage 0: reserved tokens are set aside for every entry that has a reservation.')
              : t('Stage {a}: entries are inserted in order of their Insertion Order.', { a: stageIdx })}
        </div>
        <div className="ctx-text">
          {segments.map((sg, i) =>
            hidden.has(sg.sourceId) ? (
              <span key={i} style={{ color: KIND_COLORS[sg.kind], opacity: 0.5 }}>
                [{t('Hidden')}]{'\n'}
              </span>
            ) : (
              <span key={i} style={colors ? { color: KIND_COLORS[sg.kind] } : undefined} title={sg.sourceId}>
                {sg.text}
              </span>
            ),
          )}
        </div>
        <label className="row ctx-inactive">
          {t('Show non-activated entries')} <Toggle on={showInactive} onChange={setShowInactive} label={t('Show non-activated entries')} />
        </label>
        <div style={{ overflowX: 'auto' }}>
          <table className="ctx-table">
            <thead>
              <tr>
                <th>{t('Stage')}</th>
                <th>{t('Order')}</th>
                <th>{t('Identifier')}</th>
                <th>{t('Inclusion')}</th>
                <th>{t('Reason')}</th>
                <th>{t('Key')}</th>
                <th>{t('Reserved')}</th>
                <th>{t('Tokens')}</th>
                <th>{t('Trim Type')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.included ? 1 : 0.6 }}>
                  <td>{r.stage ?? '—'}</td>
                  <td>{r.order}</td>
                  <td style={{ color: KIND_COLORS[r.kind] }}>{r.hidden ? `[${t('Hidden')}]` : t(r.label)}</td>
                  <td>{r.included ? '✓' : '✗'}</td>
                  <td>{t(REASONS[r.reason] ?? r.reason)}{r.activation ? ` (${r.activation})` : ''}</td>
                  <td>{r.key ?? ''}</td>
                  <td>{r.reservedTokens}</td>
                  <td>
                    {r.tokens}
                    {r.originalTokens !== r.tokens && r.included ? ` / ${r.originalTokens}` : ''}
                  </td>
                  <td>{r.trimType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ctx-sub">{t('Included Phrase Bias Groups')}</div>
        <table className="ctx-table">
          <thead>
            <tr>
              <th>{t('Phrases')}</th>
              <th>{t('Bias')}</th>
            </tr>
          </thead>
          <tbody>
            {ctx.phraseBias.map((g, i) => (
              <tr key={i}>
                <td>{g.phrases.join(', ')}</td>
                <td>{g.bias}</td>
              </tr>
            ))}
            {ctx.phraseBias.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function ContextSettingsModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const [tab, setTab] = useState<keyof StoryContextSettings>('memory');
  return (
    <Modal onClose={onClose} width={820} label={t('Edit Context Settings')}>
      <ModalHeader title={t('Edit Context Settings')} onClose={onClose}>
        <button type="button" className="btn small" onClick={() => store.update((s) => void (s.contextSettings = defaultContextSettings()))}>
          {t('Reset to Defaults')}
        </button>
      </ModalHeader>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'memory', label: t('Memory') },
          { value: 'authorsNote', label: t("Author's Note") },
          { value: 'loreDefaults', label: t('Default Lorebook') },
          { value: 'story', label: t('Story') },
        ]}
      />
      <div className="modal-body" style={{ paddingTop: 20 }}>
        <ContextConfigEditor value={story.contextSettings[tab]} onChange={(c) => store.update((s) => void (s.contextSettings = { ...s.contextSettings, [tab]: c }))} />
      </div>
    </Modal>
  );
}

export function EphemeralModal({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const [draft, setDraft] = useState('{+0~5,-1:}');
  const parsed = parseEphemeral(draft, story.step);
  return (
    <Modal onClose={onClose} width={720} label={t('Ephemeral Context')}>
      <ModalHeader title={t('Ephemeral Context')} onClose={onClose} />
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="eph-help">
          <div>
            {t('Ephemeral context is inserted into the context for a number of story steps (AI generations), then disappears.')}
          </div>
          <code>{'{[+]step[r]~duration,position:text}'}</code>
          <ul>
            <li>
              <code>+3</code> {t('starts 3 steps from now; without + the number is the story step to start at.')}
            </li>
            <li>
              <code>r</code> {t('repeats the entry every cycle.')}
            </li>
            <li>
              <code>~5</code> {t('stays for 5 steps.')}
            </li>
            <li>
              <code>,-2</code> {t('inserts it 2 lines from the bottom of the context (positive: from the top).')}
            </li>
          </ul>
          <div>{t('You can also type an entry on its own line in the story; it moves here when you send.')}</div>
          <div className="eph-step">
            {t('Current Story Step')}: <b>{story.step}</b>
          </div>
        </div>
        <div className="row">
          <input className="input grow" style={{ fontFamily: 'var(--font-code)' }} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('Ephemeral Context')} />
          <button
            type="button"
            className="btn primary"
            disabled={!parsed}
            onClick={() => {
              if (parsed) store.update((s) => void (s.ephemeral = [...s.ephemeral, parsed]));
              setDraft('{+0~5,-1:}');
            }}
          >
            <Plus size={14} weight="bold" /> {t('Add Entry')}
          </button>
        </div>
        {!parsed && draft && <div className="warning-text" style={{ fontSize: 13 }}>{t('Invalid format.')}</div>}
        {parsed && (
          <div className="desc" style={{ fontSize: 13 }}>
            {t('Active from step {from} to step {to}.', { from: parsed.startingStep + parsed.delay, to: parsed.startingStep + parsed.delay + parsed.duration - 1 })}
            {parsed.repeat ? ` ${t('Repeats.')}` : ''}
          </div>
        )}
        {story.ephemeral.length === 0 && <div className="desc">{t('No ephemeral entries yet.')}</div>}
        {story.ephemeral.map((e) => (
          <div key={e.id} className="provider-row">
            <code className="grow" style={{ fontSize: 13 }}>{formatEphemeral(e)}</code>
            <span className={`status ${ephemeralActive(e, story.step) ? 'on' : 'off'}`}>{ephemeralActive(e, story.step) ? t('Active') : t('Inactive')}</span>
            <button type="button" className="icon-btn" aria-label={t('Remove')} onClick={() => store.update((s) => void (s.ephemeral = s.ephemeral.filter((x) => x.id !== e.id)))}>
              <Trash size={16} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** bg0 text area with an expand toggle and a token count, as in the System Prompt modal. */
function PromptArea({ value, onChange, placeholder, label, rows }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; rows: number }) {
  const [tall, setTall] = useState(false);
  const tokens = useMemo(() => countTokens(value || placeholder || ''), [value, placeholder]);
  return (
    <div className="prompt-area">
      <textarea aria-label={label} value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} style={{ height: tall ? '60vh' : rows * 21 + 20 }} />
      <button type="button" className="icon-btn expand" aria-label={t('Expand editor')} onClick={() => setTall(!tall)}>
        <CornersOut size={16} weight="bold" />
      </button>
      <span className="tokens">
        {tokens} {t('tokens')}
      </span>
    </div>
  );
}

/** Small framed editor for Memory / Author's Note, or the System Prompt + Prefill modal. */
export function TextFieldModal({ onClose, field }: { onClose: () => void; field: 'memory' | 'authorsNote' | 'system' }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const ui = useUI.getState();
  if (field !== 'system') {
    const title = field === 'memory' ? t('Memory') : t("Author's Note");
    return (
      <Modal onClose={onClose} width={534} label={title} className="field-modal">
        <ModalHeader title={title} onClose={onClose} />
        <textarea
          autoFocus
          className="field-modal-text"
          aria-label={title}
          spellCheck={false}
          value={field === 'memory' ? story.memory : story.authorsNote}
          onChange={(e) => store.update((s) => void (field === 'memory' ? (s.memory = e.target.value) : (s.authorsNote = e.target.value)))}
        />
      </Modal>
    );
  }
  const def = story.mode === 'adventure' ? DEFAULT_SYSTEM_PROMPT_ADVENTURE : DEFAULT_SYSTEM_PROMPT_STORY;
  return (
    <Modal onClose={onClose} width={600} label={t('System Prompt')} className="system-modal">
      <ModalHeader title={t('System Prompt')} onClose={onClose} />
      <div className="modal-body">
        <div className="desc-plain">{t('The system prompt is the initial system message given to the model. Leave blank for the default system message.')}</div>
        <PromptArea label={t('System Prompt')} rows={12} value={story.systemPrompt} placeholder={def} onChange={(v) => store.update((s) => void (s.systemPrompt = v))} />
        <div className="row system-buttons">
          <button type="button" className="btn grow" disabled={!story.systemPrompt} onClick={() => store.update((s) => void (s.systemPrompt = ''))}>
            {t('Reset to Default')}
          </button>
          <button
            type="button"
            className="btn grow"
            onClick={async () => {
              store.update((s) => void (s.systemPrompt = def));
              await navigator.clipboard?.writeText(def).catch(() => {});
              ui.toast(t('Copied!'), 'success');
            }}
          >
            {t('Copy Default')}
          </button>
        </div>
        <h3 className="modal-title system-sub">{t('Prefill')}</h3>
        <div className="desc-plain">{t('The prefill is inserted at the beginning of the most recent assistant message. Leave blank to send none. Not every model accepts a prefill.')}</div>
        <PromptArea label={t('Prefill')} rows={9} value={story.prefill} onChange={(v) => store.update((s) => void (s.prefill = v))} />
      </div>
    </Modal>
  );
}

export function useOpenContextViewer() {
  return (which: 'last' | 'current') => useUI.getState().open('contextViewer', { which });
}
