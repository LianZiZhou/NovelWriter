import { useMemo, useState } from 'react';
import { ArrowRight, ArrowSquareOut, ArrowsLeftRight, Book, CaretDown, CaretUp, ChartBar, Copy, ImageSquare, CornersOut, DownloadSimple, MagnifyingGlass, Sword, Article } from '@phosphor-icons/react';
import { countTokens, exportPlaintext, exportScenario, exportStoryFile, searchLore } from '@novelwriter/core';
import { download, safeFileName, useStory, useStoryMeta } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Collapsible, Select, ToggleRow } from '../../components/ui.tsx';
import { ModelSelect } from './ModelSelect.tsx';

export function FieldBox({ value, onChange, placeholder, ariaLabel, onExpand, minHeight }: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel: string; onExpand?: () => void; minHeight?: number }) {
  const tokens = useMemo(() => countTokens(value), [value]);
  return (
    <div className="field-box">
      <textarea value={value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} style={minHeight ? { minHeight } : undefined} spellCheck={false} />
      {onExpand && (
        <button type="button" className="icon-btn expand" onClick={onExpand} aria-label={`expand ${ariaLabel}`}>
          <CornersOut size={16} weight="bold" />
        </button>
      )}
      <span className="tokens" aria-label={`${ariaLabel} contains ${tokens} tokens`}>
        {tokens} {t('tokens')}
      </span>
    </div>
  );
}

export function StoryTab() {
  const story = useStoryMeta()!;
  const presets = useStory((s) => s.allPresets)();
  const store = useStory.getState();
  const ui = useUI.getState();
  const [q, setQ] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const adventure = story.mode === 'adventure';
  const results = q ? searchLore(story.lorebook.entries, q).slice(0, 8) : [];

  const doExport = async (kind: 'file' | 'scenario' | 'text' | 'clipboard' | 'image') => {
    setExportOpen(false);
    const name = safeFileName(story.title);
    if (kind === 'file') download(`${name}.story`, exportStoryFile(story));
    else if (kind === 'scenario') download(`${name}.scenario`, exportScenario(story));
    else if (kind === 'text') download(`${name}.txt`, exportPlaintext(story), 'text/plain');
    else if (kind === 'clipboard') {
      await navigator.clipboard.writeText(exportStoryFile(story));
      ui.toast(t('Copied!'), 'success');
    } else ui.open('screenshot', {});
  };

  return (
    <div>
      <div className="panel-section mode-section" style={{ paddingTop: 14 }}>
        <svg className="mode-arcs" viewBox="0 0 280 90" preserveAspectRatio="none" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M ${-20 + i * 6} ${88 - i * 4} Q ${120 + i * 14} ${70 - i * 10} ${250 - i * 4} ${-6 + i * 3}`} />
          ))}
        </svg>
        <div className="row between" style={{ position: 'relative' }}>
          <div className="mode-card">
            <div className="mode-icon">{adventure ? <Sword size={30} /> : <Article size={30} />}</div>
            <div>
              <div className="label">{t('Story Mode')}</div>
              <div className="value">{adventure ? t('Text Adventure') : t('Storyteller')}</div>
            </div>
          </div>
          <button
            type="button"
            className="title-btn"
            aria-label={t('Story Mode')}
            title={t('Story Mode')}
            onClick={() => store.update((s) => void (s.mode = adventure ? 'storyteller' : 'adventure'))}
          >
            <ArrowsLeftRight size={18} weight="bold" />
          </button>
        </div>
        <div className="section-head">
          <span className="heading">{t('AI Model')}</span>
          <button type="button" className="link-btn" onClick={() => ui.open('settings', { tab: 'defaults' })}>
            {t('Change Default')} <ArrowSquareOut size={14} />
          </button>
        </div>
        <ModelSelect value={store.resolveModel()} onChange={(m) => store.update((s) => void (s.model = m))} />
      </div>

      <div className="panel-section">
        <div className="section-head">
          <span className="heading">{t('Config Preset')}</span>
          <button type="button" className="link-btn" onClick={() => useSettings.getState().set({ rightTab: 'generation' })}>
            {t('Edit Preset')} <ArrowRight size={14} weight="bold" />
          </button>
        </div>
        <div className="desc">{t('Changes the settings of the AI model.')}</div>
        <Select
          value={story.presetId}
          ariaLabel={t('Config Preset')}
          onChange={(id) => {
            const p = presets.find((x) => x.id === id);
            if (p) store.update((s) => {
              s.presetId = id;
              s.params = { ...p.params, maxContext: s.params.maxContext };
            });
          }}
          options={presets.map((p) => ({ value: p.id, label: p.name, group: p.builtin ? t('Built-in') : t('Your Presets') }))}
        />
        <ToggleRow
          title={t('Editor Token Probabilities')}
          desc={t('Enable to show selectable alternate tokens and probabilities in the editor.') + ' ' + t('(Not available through chat model APIs.)')}
          on={false}
          onChange={() => ui.toast(t('Token probabilities are not exposed by the connected chat model APIs.'))}
          disabled
        />
      </div>

      <div className="panel-section">
        <label className="heading" htmlFor="nw-memory">{t('Memory')}</label>
        <div className="desc">{t('The AI will better remember info placed here.')}</div>
        <FieldBox value={story.memory} ariaLabel="memory" onChange={(v) => store.update((s) => void (s.memory = v))} onExpand={() => ui.open('systemPrompt', { field: 'memory' })} />
        <label className="heading" style={{ marginTop: 22 }}>{t("Author's Note")}</label>
        <div className="desc">{t('Info placed here will strongly influence AI output.')}</div>
        <FieldBox value={story.authorsNote} ariaLabel="author's note" onChange={(v) => store.update((s) => void (s.authorsNote = v))} onExpand={() => ui.open('systemPrompt', { field: 'authorsNote' })} />
      </div>

      <div className="panel-section">
        <span className="heading">{t('Lorebook Quick Access')}</span>
        <div className="row" style={{ gap: 0 }}>
          <div className="enter-input grow">
            <input className="input" placeholder={t('Search for an entry')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search for an entry')} />
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--bg0)' }}>
              <MagnifyingGlass size={18} weight="bold" />
            </span>
          </div>
          <button type="button" className="enter-input-btn" style={{ height: 41, width: 41 }} aria-label="Open Lorebook" onClick={() => ui.open('lorebook')}>
            <Book size={18} weight="fill" />
          </button>
        </div>
        {results.length > 0 && (
          <div style={{ background: 'var(--bg0)' }}>
            {results.map((e) => (
              <button type="button" key={e.id} className="select-option" onClick={() => ui.open('lorebook', { entryId: e.id })}>
                <div style={{ fontWeight: 600 }}>{e.displayName}</div>
                <div className="desc" style={{ fontSize: 12 }}>{e.keys.join(', ')}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel-section">
        <span className="heading">{t('Story Options')}</span>
        <button type="button" className="btn dark block" style={{ border: '1px solid var(--bg2)' }} onClick={() => ui.open('stats')}>
          <ChartBar size={14} /> {t('View Story Stats')}
        </button>
        <Collapsible title={t('Experimental')} defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                if (await ui.confirm({ title: t('Trim Story'), message: t('Remove undo, redo and retry branches that are not part of the current story?') })) store.trimStory();
              }}
            >
              {t('Trim Story')}
            </button>
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                if (await ui.confirm({ title: t('Flatten Story'), message: t('Remove all history and branches, keeping only the current text?'), danger: true })) store.flattenStory();
              }}
            >
              {t('Flatten Story')}
            </button>
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                if (await ui.confirm({ title: t('Reset to Prompt'), message: t('Revert the story to its original prompt and remove all history?'), danger: true })) store.resetToPrompt();
              }}
            >
              {t('Reset to Prompt')}
            </button>
          </div>
        </Collapsible>
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 14 }}>{t('Export Story')}</div>
        <div className="split-btn">
          <button type="button" className="btn primary" onClick={() => void doExport('file')}>
            <DownloadSimple size={14} weight="bold" /> {t('To File')}
          </button>
          <button type="button" className="btn" aria-label={t('Export')} aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>
            {exportOpen ? <CaretUp size={14} weight="fill" /> : <CaretDown size={14} weight="fill" />}
          </button>
        </div>
        {exportOpen && (
          <div className="export-list fade-in">
            {(
              [
                ['scenario', t('As Scenario'), <DownloadSimple size={14} weight="bold" />],
                ['text', t('As Plaintext'), <DownloadSimple size={14} weight="bold" />],
                ['clipboard', t('To Clipboard'), <Copy size={14} weight="bold" />],
                ['image', t('As Image'), <ImageSquare size={14} weight="fill" />],
              ] as const
            ).map(([k, label, icon]) => (
              <button type="button" key={k} className="btn block" onClick={() => void doExport(k)}>
                {icon} {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="row between">
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t('Delete Story')}</span>
          <span className="desc">{t('(cannot be undone)')}</span>
        </div>
        <button
          type="button"
          className="btn danger block"
          onClick={async () => {
            if (await ui.confirm({ title: t('Delete Story'), message: t('Delete "{name}"? This cannot be undone.', { name: story.title }), confirmLabel: t('Delete'), danger: true })) {
              await store.deleteStory(story.id);
            }
          }}
        >
          {t('Delete')}
        </button>
      </div>
    </div>
  );
}
