import { useRef, useState } from 'react';
import { CaretDown, CaretUp, PencilSimple, Plus, Trash, UploadSimple } from '@phosphor-icons/react';
import { defaultParams, exportPreset, importPreset, uid, type GenerationParams, type ParamId, type SamplerId } from '@novelwriter/core';
import { download, safeFileName, useStory, useStoryMeta } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { capsOf } from '../../api.ts';
import { Collapsible, Select, SliderSetting } from '../../components/ui.tsx';

export const SAMPLER_INFO: Record<SamplerId, { label: string; help: string }> = {
  temperature: { label: 'Randomness', help: 'Reshapes token probabilities. Below 1 is more consistent, above 1 more creative.' },
  top_k: { label: 'Top-K', help: 'Keeps this many tokens, and deletes the rest.' },
  top_p: { label: 'Nucleus', help: 'Keeps the most likely tokens until their probabilities add up to this value.' },
  tfs: { label: 'Tail-Free', help: 'Removes low-probability tokens using a second-derivative threshold.' },
  top_a: { label: 'Top-A', help: 'Removes tokens below (max probability)² × A.' },
  typical_p: { label: 'Typical', help: 'Removes tokens whose probability is far from the expected entropy.' },
  min_p: { label: 'Min-P', help: 'Removes tokens below (top probability × value).' },
  mirostat: { label: 'Mirostat', help: 'Targets a set level of randomness (Tau) with a Learning Rate.' },
  unified: { label: 'Unified', help: 'Linear / Quad / Conf transform of log-probabilities.' },
};

/** What the current model's backend can take (see core/backend.ts). */
function useCaps() {
  const info = useStory((s) => s.modelInfo)();
  const flavor = info?.flavor ?? 'chat-only';
  return { flavor, caps: capsOf(info), model: info?.name ?? '' };
}

export function GenerationTab() {
  const story = useStoryMeta()!;
  const presets = useStory((s) => s.allPresets)();
  const custom = useStory((s) => s.presets);
  const store = useStory.getState();
  const ui = useUI.getState();
  const { caps, model } = useCaps();
  const can = (x: ParamId) => caps.params.includes(x);
  const fileRef = useRef<HTMLInputElement>(null);
  const [naming, setNaming] = useState<null | { mode: 'new' | 'rename'; value: string }>(null);
  const [ignored, setIgnored] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const p = story.params;
  const preset = presets.find((x) => x.id === story.presetId);
  const isCustom = custom.some((x) => x.id === story.presetId);
  const modified = !!preset && JSON.stringify(preset.params) !== JSON.stringify({ ...p, maxContext: preset.params.maxContext });

  const set = (patch: Partial<GenerationParams>) => store.update((s) => void (s.params = { ...s.params, ...patch }));
  const savePresetAs = (name: string) => {
    const np = { id: uid(), name, params: { ...p } };
    store.savePresets([...custom, np]);
    store.update((s) => void (s.presetId = np.id));
  };
  const updatePreset = () => store.savePresets(custom.map((x) => (x.id === story.presetId ? { ...x, params: { ...p } } : x)));
  const resetChanges = () => preset && store.update((s) => void (s.params = { ...defaultParams(preset.params), maxContext: s.params.maxContext }));

  const enabled = p.order.filter((s) => s.enabled).map((s) => s.id);
  const hidden = p.order.length - enabled.length;
  const unsupportedOn = enabled.filter((id) => !can(id));
  // Why this model ignores sampling settings, when it does (reasoning models fix their own; others refused some).
  const restrictedNote =
    caps.restricted === 'reasoning'
      ? t('{model} sets its own sampling (reasoning model), so Randomness and the samplers are not sent. They stay saved in the preset.', { model: model || t('This model') })
      : caps.restricted === 'learned'
        ? t('{model} refused some settings; they are no longer sent to it.', { model: model || t('This model') })
        : null;

  const samplerSliders = (id: SamplerId) => {
    if (!can(id)) return null;
    const help = (k: SamplerId) => t(SAMPLER_INFO[k].help);
    switch (id) {
      case 'temperature':
        return null; // shown in Generation Options
      case 'top_k':
        return <SliderSetting key={id} small title="Top-K" value={p.topK} min={0} max={300} step={1} def={0} onChange={(v) => set({ topK: v })} help={help('top_k')} />;
      case 'top_p':
        return <SliderSetting key={id} small title={t('Nucleus')} value={p.topP} min={0} max={1} step={0.01} def={0.95} onChange={(v) => set({ topP: v })} help={help('top_p')} />;
      case 'tfs':
        return <SliderSetting key={id} small title={t('Tail-Free')} value={p.tailFreeSampling} min={0} max={1} step={0.001} def={1} onChange={(v) => set({ tailFreeSampling: v })} help={help('tfs')} />;
      case 'top_a':
        return <SliderSetting key={id} small title="Top-A" value={p.topA} min={0} max={1} step={0.01} def={0} onChange={(v) => set({ topA: v })} help={help('top_a')} />;
      case 'typical_p':
        return <SliderSetting key={id} small title={t('Typical')} value={p.typicalP} min={0} max={1} step={0.01} def={1} onChange={(v) => set({ typicalP: v })} help={help('typical_p')} />;
      case 'min_p':
        return <SliderSetting key={id} small title="Min-P" value={p.minP} min={0} max={1} step={0.01} def={0} onChange={(v) => set({ minP: v })} help={help('min_p')} />;
      case 'mirostat':
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SliderSetting small title={t('Mirostat Tau')} value={p.mirostatTau} min={0} max={6} step={0.01} def={0} onChange={(v) => set({ mirostatTau: v })} help={help('mirostat')} />
            <SliderSetting small title={t('Mirostat Learning Rate')} value={p.mirostatLr} min={0} max={1} step={0.01} def={1} onChange={(v) => set({ mirostatLr: v })} />
          </div>
        );
      case 'unified':
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SliderSetting small title={t('Unified Quad')} value={p.unifiedQuad} min={0} max={2} step={0.01} def={0} onChange={(v) => set({ unifiedQuad: v })} help={help('unified')} />
            <SliderSetting small title={t('Unified Conf')} value={p.unifiedConf} min={0} max={2} step={0.01} def={0} onChange={(v) => set({ unifiedConf: v })} />
            {p.unifiedConf > 0 && p.unifiedConf < -p.unifiedQuad && <div className="desc warning-text">{t('Conf only makes sense above -Quad.')}</div>}
          </div>
        );
    }
  };

  const banner = modified && ignored !== story.presetId;
  return (
    <div>
      <div className="panel-section">
        <div className="section-head">
          <span className="heading">{t('Config Preset')}</span>
          <span className="row" style={{ gap: 12 }}>
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} aria-label={t('Import preset')} title={t('Import preset')}>
              <UploadSimple size={14} />
            </button>
            <button type="button" className="link-btn" onClick={() => download(`${safeFileName(preset?.name ?? 'preset')}.preset`, exportPreset(preset?.name ?? 'Preset', p))}>
              {t('Export')}
            </button>
          </span>
        </div>
        <div className="desc">{t('Choose from a selection of generation settings.')}</div>
        {naming ? (
          <input
            autoFocus
            className="input"
            placeholder={t('Type name here and press enter')}
            aria-label={t('Preset name')}
            value={naming.value}
            onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            onBlur={() => setNaming(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(null);
              if (e.key !== 'Enter' || !naming.value.trim()) return;
              if (naming.mode === 'new') savePresetAs(naming.value.trim());
              else store.savePresets(custom.map((x) => (x.id === story.presetId ? { ...x, name: naming.value.trim() } : x)));
              setNaming(null);
            }}
          />
        ) : (
          <div className="row" style={{ gap: 4 }}>
            <Select
              className="grow"
              value={story.presetId}
              ariaLabel={t('Select a Settings Preset')}
              onChange={(id) => {
                const pr = presets.find((x) => x.id === id);
                if (pr) store.update((s) => {
                  s.presetId = id;
                  s.params = { ...defaultParams(pr.params), maxContext: s.params.maxContext };
                });
              }}
              options={presets.map((x) => ({ value: x.id, label: x.id === story.presetId && modified ? `${x.name} *` : x.name, group: x.builtin ? t('Default') : t('Your Presets') }))}
            />
            <button type="button" className="icon-btn preset-pen" disabled={!isCustom} aria-label={t('Rename Preset')} title={t('Rename Preset')} onClick={() => setNaming({ mode: 'rename', value: preset?.name ?? '' })}>
              <PencilSimple size={14} />
            </button>
            {isCustom && (
              <button
                type="button"
                className="icon-btn preset-pen"
                aria-label={t('Delete preset')}
                title={t('Delete preset')}
                onClick={async () => {
                  if (await ui.confirm({ title: t('Delete preset'), message: preset?.name, danger: true, confirmLabel: t('Delete') })) {
                    store.savePresets(custom.filter((x) => x.id !== story.presetId));
                    store.update((s) => void (s.presetId = 'default'));
                  }
                }}
              >
                <Trash size={14} />
              </button>
            )}
            <button type="button" className="enter-input-btn" style={{ height: 40, width: 40 }} aria-label={t('Create New Preset')} title={t('Create New Preset')} onClick={() => setNaming({ mode: 'new', value: `${preset?.name ?? 'Preset'} (custom)` })}>
              <Plus size={16} weight="bold" />
            </button>
          </div>
        )}
        {banner && (
          <div className="preset-banner fade-in" role="status">
            {isCustom ? (
              <>
                <div>{t('Settings saved to story.')}</div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="grow">{t('Update active Preset?')}</span>
                  <button type="button" className="btn small" onClick={updatePreset}>
                    {t('Save')}
                  </button>
                  <button type="button" className="btn small" onClick={() => setIgnored(story.presetId)}>
                    {t('Ignore')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>{t('Settings saved to story.')}</div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="grow">{t('Save to new Preset?')}</span>
                  <button type="button" className="btn small" onClick={() => setNaming({ mode: 'new', value: `${preset?.name ?? 'Preset'} (custom)` })}>
                    {t('Save')}
                  </button>
                  <button type="button" className="btn small" onClick={() => setIgnored(story.presetId)}>
                    {t('Ignore')}
                  </button>
                </div>
              </>
            )}
            <div style={{ position: 'relative' }}>
              <button type="button" className="link-btn" onClick={() => setOtherOpen(!otherOpen)} aria-expanded={otherOpen}>
                {t('Other Options')} {otherOpen ? <CaretUp size={12} weight="fill" /> : <CaretDown size={12} weight="fill" />}
              </button>
              {otherOpen && (
                <div className="preset-other">
                  <button type="button" onClick={() => (resetChanges(), setOtherOpen(false))}>
                    {t('Reset Changes')}
                  </button>
                  <button type="button" onClick={() => (setNaming({ mode: 'new', value: `${preset?.name ?? 'Preset'} (custom)` }), setOtherOpen(false))}>
                    {t('Save to New Preset')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".preset,.json,.gensettings,.generationset"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const imported = importPreset(JSON.parse(await f.text()), f.name.replace(/\.[^.]+$/, ''));
              store.savePresets([...custom, { id: uid(), ...imported }]);
              ui.toast(t('Imported preset "{name}"', { name: imported.name }), 'success');
            } catch (err) {
              ui.toast((err as Error).message, 'error');
            }
          }}
        />
      </div>

      <div className="panel-section" style={{ gap: 18 }}>
        <Collapsible title={t('Generation Options')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 14 }}>
            {restrictedNote && <div className="desc warning-text">{restrictedNote}</div>}
            <SliderSetting
              title={t('Randomness')}
              desc={t('The higher the value, the more random the output!')}
              value={p.temperature}
              min={0.05}
              max={2.5}
              step={0.01}
              def={1}
              disabled={!can('temperature')}
              onChange={(v) => set({ temperature: v })}
            />
            <SliderSetting
              title={t('Output Length')}
              desc={t('Increase the length of the generated responses')}
              value={p.maxLength}
              min={4}
              max={4000}
              step={4}
              def={1024}
              onChange={(v) => set({ maxLength: v })}
              prefix="~"
              suffix={t('Characters')}
            />
            <SliderSetting
              title={t('Context Size')}
              desc={t('Maximum tokens of story context sent to the AI.')}
              value={p.maxContext}
              min={1024}
              max={131072}
              step={512}
              def={8192}
              onChange={(v) => set({ maxContext: v })}
              suffix={t('tokens')}
            />
          </div>
        </Collapsible>
        <Collapsible title={t('Advanced Options')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 14 }}>
            <div className="desc warning-text" style={{ opacity: 1 }}>
              {t("Experimentation with these settings is encouraged, but be warned that their effects aren't always obvious.")}
              <a className="guide-link" href="https://github.com/LianZiZhou/NovelWriter#generation-settings" target="_blank" rel="noreferrer">
                {t('This guide explains these settings.')}
              </a>
            </div>
            <div className="desc" style={{ opacity: 0.85 }}>{t('Sampling')}</div>
            {p.order.filter((s) => s.enabled).map((s) => samplerSliders(s.id))}
            <div>
              <button type="button" className="change-samplers" onClick={() => ui.open('samplers')}>
                {t('Change Samplers')}
              </button>
              {hidden > 0 && <div className="desc" style={{ marginTop: 8 }}>{t('{n} hidden', { n: hidden })}</div>}
              {unsupportedOn.filter((x) => x !== 'temperature').length > 0 && (
                <div className="desc" style={{ marginTop: 4 }}>
                  {t('{n} not used by {model}', { n: unsupportedOn.filter((x) => x !== 'temperature').length, model: model || t('this model') })}
                </div>
              )}
            </div>
            {(can('rep_pen') || can('rep_pen_range') || can('rep_pen_slope') || can('phrase_rep_pen')) && <div className="desc" style={{ opacity: 0.85 }}>{t('Repetition Penalty')}</div>}
            {can('rep_pen') && <SliderSetting small title={t('Repetition Penalty')} value={p.repetitionPenalty} min={1} max={2} step={0.001} def={1} onChange={(v) => set({ repetitionPenalty: v })} help={t('Higher values make the output less repetitive.')} />}
            {can('rep_pen_range') && <SliderSetting small title={t('Range')} value={p.repetitionPenaltyRange} min={0} max={8192} step={16} def={0} onChange={(v) => set({ repetitionPenaltyRange: v })} help={t('How many tokens, starting from the last generated one, will be considered repeated if they appear in the next output. 0 = the whole context.')} />}
            {can('rep_pen_slope') && <SliderSetting small title={t('Slope')} value={p.repetitionPenaltySlope} min={0} max={10} step={0.01} def={0} onChange={(v) => set({ repetitionPenaltySlope: v })} help={t('Affects the ramping of the penalty’s harshness, starting from the final token.')} />}
            {can('phrase_rep_pen') && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }} title={t('Penalizes repeating whole phrases (sent as DRY sampling).')}>
                  {t('Phrase Repetition Penalty')}
                </div>
                <Select
                  value={p.phraseRepPen}
                  onChange={(v) => set({ phraseRepPen: v })}
                  options={(['off', 'very_light', 'light', 'medium', 'aggressive', 'very_aggressive'] as const).map((v) => ({ value: v, label: v === 'off' ? t('Off') : t(v.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())) }))}
                />
              </div>
            )}
            {(can('presence') || can('frequency')) && (
              <div>
                <div className="desc" style={{ opacity: 0.85 }}>{t('Alternate Repetition Penalty')}</div>
                <div className="desc warning-text" style={{ opacity: 1, marginTop: 4 }}>
                  {t('These options will strongly impact generation and are not recommended to set to high values.')}
                </div>
              </div>
            )}
            {can('presence') && <SliderSetting small title={t('Presence')} value={p.repetitionPenaltyPresence} min={-2} max={2} step={0.01} def={0} onChange={(v) => set({ repetitionPenaltyPresence: v })} note={p.repetitionPenaltyPresence === 0 ? '[0] (off)' : undefined} defText={`${t('Default: {v}', { v: 0 })} (off)`} help={t('Applies a flat penalty to every token that has already appeared.')} />}
            {can('frequency') && <SliderSetting small title={t('Frequency')} value={p.repetitionPenaltyFrequency} min={-2} max={2} step={0.01} def={0} onChange={(v) => set({ repetitionPenaltyFrequency: v })} note={p.repetitionPenaltyFrequency === 0 ? '[0] (off)' : undefined} defText={`${t('Default: {v}', { v: 0 })} (off)`} help={t('Penalizes tokens more the more often they have appeared.')} />}
            <SliderSetting small title={t('Min Output Length')} value={p.minLength} min={1} max={500} step={1} def={1} onChange={(v) => set({ minLength: v })} help={can('min_length') ? t('Minimum characters to generate; also keeps stop sequences from ending the output earlier.') : t('Stop sequences are ignored until this many characters have been generated.')} />
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
