import { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Plus, Trash } from '@phosphor-icons/react';
import { defaultContextSettings, formatEphemeral, parseEphemeral, ephemeralActive, type BuiltContext, type StoryContextSettings } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Checkbox, Modal, ModalHeader, Tabs } from '../../components/ui.tsx';
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

export function ContextViewerModal({ onClose, which }: { onClose: () => void; which: 'last' | 'current' }) {
  const last = useStory((s) => s.lastContext);
  const ctx = useMemo<BuiltContext | null>(() => (which === 'last' ? last : useStory.getState().previewContext()), [which, last]);
  const [stage, setStage] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  if (!ctx) {
    return (
      <Modal onClose={onClose} width={600}>
        <ModalHeader title={t('Context Viewer')} onClose={onClose} />
        <div className="muted">{t('No context yet. Send a generation first.')}</div>
      </Modal>
    );
  }
  const segments = stage === null ? ctx.segments : ctx.stages[stage] ?? ctx.segments;
  const hidden = new Set(ctx.report.filter((r) => r.hidden).map((r) => r.id));
  const rows = ctx.report.filter((r) => showInactive || r.included || r.kind !== 'lore');
  return (
    <Modal onClose={onClose} width={1100} label={t('Context Viewer')}>
      <ModalHeader title={`${t('Context Viewer')} — ${which === 'last' ? t('Last Context') : t('Current Context')}`} onClose={onClose} />
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ContextBar ctx={ctx} />
        <div className="row between">
          <div className="ctx-legend">
            {(Object.keys(KIND_COLORS) as (keyof typeof KIND_COLORS)[]).map((k) => (
              <span key={k}>
                <i style={{ background: KIND_COLORS[k] }} /> {t(KIND_LABELS[k])}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 13 }}>
            {ctx.usedTokens} / {ctx.maxTokens} {t('tokens')}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn small" disabled={stage === 0 || ctx.stages.length === 0} onClick={() => setStage((s) => (s === null ? ctx.stages.length - 2 : Math.max(0, s - 1)))}>
            <CaretLeft size={12} /> {t('Previous Stage')}
          </button>
          <span style={{ fontSize: 13, minWidth: 120, textAlign: 'center' }}>
            {t('Stage')} {stage === null ? ctx.stages.length - 1 : stage} / {Math.max(0, ctx.stages.length - 1)}
          </span>
          <button type="button" className="btn small" disabled={stage === null} onClick={() => setStage((s) => (s === null || s + 1 >= ctx.stages.length - 1 ? null : s + 1))}>
            {t('Next Stage')} <CaretRight size={12} />
          </button>
        </div>
        <div className="ctx-text">
          {segments.map((s, i) =>
            hidden.has(s.sourceId) ? (
              <span key={i} style={{ color: KIND_COLORS[s.kind], opacity: 0.5 }}>
                [{t('Hidden')}]{'\n'}
              </span>
            ) : (
              <span key={i} style={{ color: KIND_COLORS[s.kind] }} title={s.sourceId}>
                {s.text}
              </span>
            ),
          )}
        </div>
        <Checkbox on={showInactive} onChange={setShowInactive} label={t('Show non-activated entries')} />
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
        {ctx.phraseBias.length > 0 && (
          <div style={{ fontSize: 13 }}>
            <b>{t('Included Phrase Bias Groups')}:</b> {ctx.phraseBias.map((g) => `${g.phrases.join(', ')} (${g.bias})`).join(' · ')}
          </div>
        )}
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
        <div className="desc">
          {t('Format: {+delay[r]~duration,position:text}. Delay and duration count story steps (AI generations). Current step:')} <b>{story.step}</b>
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
            <Plus size={14} weight="bold" /> {t('Add')}
          </button>
        </div>
        {!parsed && draft && <div className="warning-text" style={{ fontSize: 13 }}>{t('Invalid format.')}</div>}
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

/** Large editor for Memory, Author's Note, or the system prompt + prefill. */
export function TextFieldModal({ onClose, field }: { onClose: () => void; field: 'memory' | 'authorsNote' | 'system' }) {
  const story = useStory((s) => s.current)!;
  const store = useStory.getState();
  const title = field === 'memory' ? t('Memory') : field === 'authorsNote' ? t("Author's Note") : t('System Prompt');
  return (
    <Modal onClose={onClose} width={900} label={title}>
      <ModalHeader title={title} onClose={onClose} />
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {field === 'system' ? (
          <>
            <div className="desc">{t('Leave empty to use the default system prompt.')}</div>
            <textarea className="textarea" style={{ minHeight: 260 }} value={story.systemPrompt} onChange={(e) => store.update((s) => void (s.systemPrompt = e.target.value))} placeholder={t('System Prompt')} />
            <div className="heading">{t('Prefill')}</div>
            <div className="desc">{t('Text placed at the start of the AI response. Not all models support prefill.')}</div>
            <textarea className="textarea" value={story.prefill} onChange={(e) => store.update((s) => void (s.prefill = e.target.value))} />
          </>
        ) : (
          <textarea
            autoFocus
            className="textarea"
            style={{ minHeight: '55vh', fontSize: 15 }}
            value={field === 'memory' ? story.memory : story.authorsNote}
            onChange={(e) => store.update((s) => void (field === 'memory' ? (s.memory = e.target.value) : (s.authorsNote = e.target.value)))}
          />
        )}
      </div>
    </Modal>
  );
}

export function useOpenContextViewer() {
  return (which: 'last' | 'current') => useUI.getState().open('contextViewer', { which });
}
