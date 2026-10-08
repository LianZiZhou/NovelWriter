import { useRef } from 'react';
import { PencilSimple, Plus, Trash, UploadSimple } from '@phosphor-icons/react';
import { defaultParams, uid, type GenerationParams, type SamplerId } from '@novelwriter/core';
import { download, safeFileName, useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Collapsible, Select, SliderSetting, ToggleRow } from '../../components/ui.tsx';

export const SAMPLER_INFO: Record<SamplerId, { label: string; help: string }> = {
  temperature: { label: 'Randomness', help: 'Reshapes token probabilities. Below 1 is more consistent, above 1 more creative.' },
  top_k: { label: 'Top-K', help: 'Keeps only the K most likely tokens.' },
  top_p: { label: 'Nucleus', help: 'Keeps the most likely tokens until their cumulative probability reaches this value.' },
  tfs: { label: 'Tail-Free', help: 'Removes low-probability tokens using a second-derivative threshold.' },
  top_a: { label: 'Top-A', help: 'Removes tokens below (max probability)² × A.' },
  typical_p: { label: 'Typical', help: 'Removes tokens whose probability is far from the expected entropy.' },
  min_p: { label: 'Min-P', help: 'Removes tokens below (top probability × value).' },
  mirostat: { label: 'Mirostat', help: 'Targets a set level of randomness (Tau) with a Learning Rate.' },
  unified: { label: 'Unified', help: 'Linear / Quad / Conf transform of log-probabilities.' },
};

/** Whether the current model accepts extra sampling params (OpenAI-compatible APIs). */
function useSamplingSupport(): boolean {
  const info = useStory((s) => s.modelInfo)();
  return !info || info.api === 'openai-completions';
}

export function GenerationTab() {
  const story = useStory((s) => s.current)!;
  const presets = useStory((s) => s.allPresets)();
  const custom = useStory((s) => s.presets);
  const store = useStory.getState();
  const ui = useUI.getState();
  const supported = useSamplingSupport();
  const fileRef = useRef<HTMLInputElement>(null);
  const p = story.params;
  const preset = presets.find((x) => x.id === story.presetId);
  const modified = preset && JSON.stringify(preset.params) !== JSON.stringify({ ...p, maxContext: preset.params.maxContext });

  const set = (patch: Partial<GenerationParams>) => {
    store.update((s) => void (s.params = { ...s.params, ...patch }));
    // Custom presets track their edits.
    const cp = custom.find((x) => x.id === story.presetId);
    if (cp) store.savePresets(custom.map((x) => (x.id === cp.id ? { ...x, params: { ...story.params, ...patch } } : x)));
  };

  const enabled = p.order.filter((s) => s.enabled).map((s) => s.id);
  const hidden = p.order.length - enabled.length;
  const na = supported ? undefined : t('Not supported by the current model; saved with the preset.');

  const samplerSliders = (id: SamplerId) => {
    switch (id) {
      case 'temperature':
        return null; // shown in Generation Options
      case 'top_k':
        return <SliderSetting key={id} small title="Top-K" value={p.topK} min={0} max={300} step={1} def={0} onChange={(v) => set({ topK: v })} help={na ?? t(SAMPLER_INFO.top_k.help)} disabled={!supported} />;
      case 'top_p':
        return <SliderSetting key={id} small title={t('Nucleus')} value={p.topP} min={0} max={1} step={0.01} def={0.95} onChange={(v) => set({ topP: v })} help={na ?? t(SAMPLER_INFO.top_p.help)} disabled={!supported && false} />;
      case 'tfs':
        return <SliderSetting key={id} small title={t('Tail-Free')} value={p.tailFreeSampling} min={0} max={1} step={0.001} def={1} onChange={(v) => set({ tailFreeSampling: v })} help={na ?? t(SAMPLER_INFO.tfs.help)} disabled={!supported} />;
      case 'top_a':
        return <SliderSetting key={id} small title="Top-A" value={p.topA} min={0} max={1} step={0.01} def={0} onChange={(v) => set({ topA: v })} help={na ?? t(SAMPLER_INFO.top_a.help)} disabled={!supported} />;
      case 'typical_p':
        return <SliderSetting key={id} small title={t('Typical')} value={p.typicalP} min={0} max={1} step={0.01} def={1} onChange={(v) => set({ typicalP: v })} help={na ?? t(SAMPLER_INFO.typical_p.help)} disabled={!supported} />;
      case 'min_p':
        return <SliderSetting key={id} small title="Min-P" value={p.minP} min={0} max={1} step={0.01} def={0} onChange={(v) => set({ minP: v })} help={na ?? t(SAMPLER_INFO.min_p.help)} disabled={!supported} />;
      case 'mirostat':
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SliderSetting small title={t('Mirostat Tau')} value={p.mirostatTau} min={0} max={6} step={0.01} def={0} onChange={(v) => set({ mirostatTau: v })} disabled={!supported} help={na} />
            <SliderSetting small title={t('Mirostat Learning Rate')} value={p.mirostatLr} min={0} max={1} step={0.01} def={1} onChange={(v) => set({ mirostatLr: v })} disabled={!supported} help={na} />
          </div>
        );
      case 'unified':
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SliderSetting small title={t('Unified Linear')} value={p.unifiedLinear} min={0} max={2} step={0.01} def={1} onChange={(v) => set({ unifiedLinear: v })} disabled={!supported} help={na} />
            <SliderSetting small title={t('Unified Quad')} value={p.unifiedQuad} min={0} max={2} step={0.01} def={0} onChange={(v) => set({ unifiedQuad: v })} disabled={!supported} help={na} />
            <SliderSetting small title={t('Unified Conf')} value={p.unifiedConf} min={0} max={2} step={0.01} def={0} onChange={(v) => set({ unifiedConf: v })} disabled={!supported} help={na} />
          </div>
        );
    }
  };

  return (
    <div>
      <div className="panel-section">
        <div className="section-head">
          <span className="heading">{t('Config Preset')}</span>
          <span className="row" style={{ gap: 12 }}>
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} aria-label={t('Import preset')}>
              <UploadSimple size={14} />
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => download(`${safeFileName(preset?.name ?? 'preset')}.preset`, JSON.stringify({ presetVersion: 1, name: preset?.name ?? 'Preset', novelwriter: p }, null, 2))}
            >
              {t('Export')}
            </button>
          </span>
        </div>
        <div className="desc">{t('Choose from a selection of generation settings.')}</div>
        <div className="row" style={{ gap: 4 }}>
          <Select
            value={story.presetId}
            ariaLabel={t('Config Preset')}
            onChange={(id) => {
              const pr = presets.find((x) => x.id === id);
              if (pr) store.update((s) => {
                s.presetId = id;
                s.params = { ...defaultParams(pr.params), maxContext: s.params.maxContext };
              });
            }}
            options={presets.map((x) => ({ value: x.id, label: x.id === story.presetId && modified ? `${x.name} *` : x.name, group: x.builtin ? t('Built-in') : t('Your Presets') }))}
          />
          {custom.some((x) => x.id === story.presetId) ? (
            <>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 36, height: 40 }}
                aria-label={t('Rename')}
                onClick={() => {
                  const name = prompt(t('Preset name'), preset?.name);
                  if (name) store.savePresets(custom.map((x) => (x.id === story.presetId ? { ...x, name } : x)));
                }}
              >
                <PencilSimple size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 36, height: 40 }}
                aria-label={t('Delete preset')}
                onClick={async () => {
                  if (await ui.confirm({ title: t('Delete preset'), message: preset?.name, danger: true, confirmLabel: t('Delete') })) {
                    store.savePresets(custom.filter((x) => x.id !== story.presetId));
                    store.update((s) => void (s.presetId = 'default'));
                  }
                }}
              >
                <Trash size={14} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="enter-input-btn"
            style={{ height: 40, width: 40 }}
            aria-label={t('Save as new preset')}
            title={t('Save as new preset')}
            onClick={() => {
              const name = prompt(t('Preset name'), `${preset?.name ?? 'Preset'} (custom)`);
              if (!name) return;
              const np = { id: uid(), name, params: { ...p } };
              store.savePresets([...custom, np]);
              store.update((s) => void (s.presetId = np.id));
            }}
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".preset,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const raw = JSON.parse(await f.text()) as { name?: string; novelwriter?: GenerationParams };
              if (raw.novelwriter) {
                const np = { id: uid(), name: raw.name ?? f.name, params: defaultParams(raw.novelwriter) };
                store.savePresets([...custom, np]);
              } else await store.importFiles([f]);
            } catch (err) {
              ui.toast((err as Error).message, 'error');
            }
          }}
        />
      </div>

      <div className="panel-section" style={{ gap: 18 }}>
        <Collapsible title={t('Generation Options')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 14 }}>
            <SliderSetting title={t('Randomness')} desc={t('The higher the value, the more random the output!')} value={p.temperature} min={0.05} max={2.5} step={0.01} def={1} onChange={(v) => set({ temperature: v })} />
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
        <Collapsible title={t('Advanced Options')} defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 14 }}>
            <div className="desc warning-text" style={{ opacity: 1 }}>
              {t("Experimentation with these settings is encouraged, but be warned that their effects aren't always obvious.")}
            </div>
            {!supported && <div className="desc">{t('Not supported by the current model; saved with the preset.')}</div>}
            <div className="desc" style={{ opacity: 0.85 }}>{t('Sampling')}</div>
            {p.order.filter((s) => s.enabled).map((s) => samplerSliders(s.id))}
            <div>
              <button type="button" className="btn block" style={{ justifyContent: 'flex-start', background: 'var(--bg3)' }} onClick={() => ui.open('samplers')}>
                {t('Change Samplers')}
              </button>
              {hidden > 0 && <div className="desc" style={{ marginTop: 8 }}>{t('{n} hidden', { n: hidden })}</div>}
            </div>
            <div className="desc" style={{ opacity: 0.85 }}>{t('Repetition Penalty')}</div>
            <SliderSetting small title={t('Repetition Penalty')} value={p.repetitionPenalty} min={1} max={2} step={0.001} def={1} onChange={(v) => set({ repetitionPenalty: v })} disabled={!supported} help={na} />
            <SliderSetting small title={t('Range')} value={p.repetitionPenaltyRange} min={0} max={8192} step={16} def={0} onChange={(v) => set({ repetitionPenaltyRange: v })} disabled={!supported || p.dynamicPenaltyRange} help={na} />
            <SliderSetting small title={t('Slope')} value={p.repetitionPenaltySlope} min={0} max={10} step={0.01} def={0} onChange={(v) => set({ repetitionPenaltySlope: v })} disabled={!supported} help={na} />
            <ToggleRow title={t('Dynamic Range')} on={p.dynamicPenaltyRange} onChange={(v) => set({ dynamicPenaltyRange: v })} />
            <ToggleRow title={t('Use Default Whitelist')} on={p.repetitionPenaltyWhitelist} onChange={(v) => set({ repetitionPenaltyWhitelist: v })} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{t('Phrase Repetition Penalty')}</div>
              <Select
                value={p.phraseRepPen}
                onChange={(v) => set({ phraseRepPen: v })}
                options={(['off', 'very_light', 'light', 'medium', 'aggressive', 'very_aggressive'] as const).map((v) => ({ value: v, label: v === 'off' ? t('Off') : t(v.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())) }))}
              />
            </div>
            <div>
              <div className="desc" style={{ opacity: 0.85 }}>{t('Alternate Repetition Penalty')}</div>
              <div className="desc warning-text" style={{ opacity: 1, marginTop: 4 }}>
                {t('These options will strongly impact generation and are not recommended to set to high values.')}
              </div>
            </div>
            <SliderSetting small title={t('Presence')} value={p.repetitionPenaltyPresence} min={-2} max={2} step={0.01} def={0} onChange={(v) => set({ repetitionPenaltyPresence: v })} note={p.repetitionPenaltyPresence === 0 ? '[0] (off)' : undefined} defText={`${t('Default: {v}', { v: 0 })} (off)`} />
            <SliderSetting small title={t('Frequency')} value={p.repetitionPenaltyFrequency} min={-2} max={2} step={0.01} def={0} onChange={(v) => set({ repetitionPenaltyFrequency: v })} note={p.repetitionPenaltyFrequency === 0 ? '[0] (off)' : undefined} defText={`${t('Default: {v}', { v: 0 })} (off)`} />
            <SliderSetting small title={t('Min Output Length')} value={p.minLength} min={1} max={500} step={1} def={1} onChange={(v) => set({ minLength: v })} help={t('Minimum characters before stop sequences can trigger.')} />
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
