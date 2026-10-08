import { useMemo, useState } from 'react';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { exportBiasGroups, type BuiltContext, type ContextSourceKind } from '@novelwriter/core';
import { download, safeFileName, useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Collapsible, EnterInput, ToggleRow } from '../../components/ui.tsx';
import { PhraseBiasEditor } from './PhraseBiasEditor.tsx';

export const KIND_COLORS: Record<ContextSourceKind, string> = {
  story: 'var(--text-ai)',
  memory: 'var(--text-prompt)',
  authorsNote: 'var(--text-edit)',
  lore: 'var(--text-user)',
  subcontext: '#75cf67',
  ephemeral: '#9773ff',
  attg: '#ec56a7',
};

export const KIND_LABELS: Record<ContextSourceKind, string> = {
  story: 'Story',
  memory: 'Memory',
  authorsNote: "Author's Note",
  lore: 'Lorebook',
  subcontext: 'Subcontext',
  ephemeral: 'Ephemeral',
  attg: 'ATTG',
};

export function ContextBar({ ctx }: { ctx: BuiltContext | null }) {
  const parts = useMemo(() => {
    if (!ctx) return [];
    const total = Math.max(ctx.maxTokens, 1);
    return ctx.report
      .filter((r) => r.included)
      .map((r) => ({ kind: r.kind, label: r.label, tokens: r.tokens, pct: (r.tokens / total) * 100 }));
  }, [ctx]);
  return (
    <div className="context-bar" role="img" aria-label="Context usage">
      {parts.map((p, i) => (
        <div key={i} title={`${t(p.label)}: ${p.tokens} ${t('tokens')} (${p.pct.toFixed(1)}%)`} style={{ width: `${p.pct}%`, background: KIND_COLORS[p.kind], opacity: 0.75 }} />
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <span className="heading">{children}</span>;
}

export function AdvancedTab() {
  const story = useStory((s) => s.current)!;
  const lastContext = useStory((s) => s.lastContext);
  const store = useStory.getState();
  const ui = useUI.getState();
  const [preview, setPreview] = useState<BuiltContext | null>(null);
  const ctx = preview ?? lastContext;

  return (
    <div>
      <div className="panel-section">
        <Collapsible title={<SectionTitle>{t('Context')}</SectionTitle>} className="">
          <div className="desc" style={{ marginBottom: 10 }}>{t("Get a full view of what's sent to the AI.")}</div>
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="grow">
              <ContextBar ctx={ctx} />
            </div>
            <button type="button" className="icon-btn" aria-label={t('Refresh')} onClick={() => setPreview(store.previewContext())}>
              <ArrowClockwise size={16} weight="bold" />
            </button>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn grow" disabled={!lastContext} onClick={() => ui.open('contextViewer', { which: 'last' })}>
              {t('Last Context')}
            </button>
            <button type="button" className="btn grow" onClick={() => ui.open('contextViewer', { which: 'current' })}>
              {t('Current Context')}
            </button>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            <button type="button" className="btn grow" onClick={() => ui.open('contextSettings')}>
              {t('Edit Context Settings')}
            </button>
            <button type="button" className="btn grow" onClick={() => ui.open('ephemeral')}>
              {t('Ephemeral Context')}
            </button>
          </div>
          <button type="button" className="btn block" style={{ marginTop: 10 }} onClick={() => ui.open('systemPrompt', { field: 'system' })}>
            {t('Edit System Prompt')}
          </button>
        </Collapsible>
      </div>

      <div className="panel-section">
        <Collapsible title={<SectionTitle>{t('User Scripts')}</SectionTitle>} className="">
          <div className="desc" style={{ marginBottom: 10 }}>{t('Extend NovelWriter with custom scripts.')}</div>
          <button type="button" className="btn block" onClick={() => ui.open('scripts')}>
            {t('Edit User Scripts')}
            {story.scripts.some((x) => x.enabled) ? ` (${story.scripts.filter((x) => x.enabled).length})` : ''}
          </button>
        </Collapsible>
      </div>

      <div className="panel-section">
        <Collapsible
          title={<SectionTitle>{t('Phrase Bias')}</SectionTitle>}
          className=""
          right={
            <button type="button" className="link-btn" onClick={() => download(`${safeFileName(story.title)}.bias`, exportBiasGroups(story.phraseBias))}>
              {t('Export')}
            </button>
          }
        >
          <div className="desc" style={{ marginBottom: 10 }}>{t("Weigh the AI's chance of generating specific tokens.")}</div>
          <PhraseBiasEditor groups={story.phraseBias} onChange={(g) => store.update((s) => void (s.phraseBias = g))} />
        </Collapsible>
      </div>

      <div className="panel-section">
        <Collapsible title={<SectionTitle>{t('Banned Tokens')}</SectionTitle>} className="" defaultOpen={false}>
          <div className="desc" style={{ marginBottom: 10 }}>{t('The AI will be told never to write these. Use {curly braces} for exact text.')}</div>
          <EnterInput placeholder={t('Type here and hit enter to ban a phrase')} onSubmit={(v) => store.update((s) => void (s.bannedTokens = [...s.bannedTokens, v]))} />
          <div className="chips" style={{ marginTop: 8 }}>
            {story.bannedTokens.map((b, i) => (
              <span className="key-chip" key={i}>
                {b}
                <button type="button" aria-label={t('Remove')} onClick={() => store.update((s) => void (s.bannedTokens = s.bannedTokens.filter((_, j) => j !== i)))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <ToggleRow title={t('Ban Bracket Generation')} on={story.banBrackets} onChange={(v) => store.update((s) => void (s.banBrackets = v))} />
          </div>
        </Collapsible>
      </div>

      <div className="panel-section">
        <ToggleRow
          title={t('Avoid Overused Words')}
          desc={t('Reduces the chance of generating words and phrases overused by AI models.')}
          on={story.avoidOverusedWords}
          onChange={(v) => store.update((s) => void (s.avoidOverusedWords = v))}
        />
      </div>

      <div className="panel-section">
        <Collapsible title={<SectionTitle>{t('Stop Sequences')}</SectionTitle>} className="">
          <EnterInput placeholder={t('Type here and hit enter to add a stop sequence')} onSubmit={(v) => store.update((s) => void (s.stopSequences = [...s.stopSequences, v.replace(/\\n/g, '\n')]))} />
          <div className="chips" style={{ marginTop: 8 }}>
            {story.stopSequences.map((b, i) => (
              <span className="key-chip" key={i}>
                {JSON.stringify(b).slice(1, -1)}
                <button type="button" aria-label={t('Remove')} onClick={() => store.update((s) => void (s.stopSequences = s.stopSequences.filter((_, j) => j !== i)))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </Collapsible>
      </div>

      <div className="panel-section">
        <span className="heading">{t('Duplicate and Start as Scenario')}</span>
        <div className="desc">{t('Imports current story as a scenario with placeholders')}</div>
        <button
          type="button"
          className="btn block"
          onClick={async () => {
            await store.duplicateStory(story.id);
            ui.open('placeholders');
          }}
        >
          {t('Duplicate and Start as Scenario')}
        </button>
      </div>
    </div>
  );
}
