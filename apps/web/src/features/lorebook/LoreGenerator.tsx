import { useState } from 'react';
import { LORE_GEN_TYPES, buildLoreRequest, type LoreEntry } from '@novelwriter/core';
import { generateText } from '../../api.ts';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Checkbox, Select } from '../../components/ui.tsx';

/** Session-only generation history, as in the original (cleared on reload). */
const history: string[] = [];

export function LoreGenerator({ entry, onResult }: { entry: LoreEntry; onResult: (text: string) => void }) {
  const [type, setType] = useState<string>('General');
  const [input, setInput] = useState(entry.displayName);
  const [ctx, setCtx] = useState({ memory: false, an: false, story: false });
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const run = async (continueText: boolean) => {
    const store = useStory.getState();
    const s = store.current;
    // Settings → Defaults → Lorebook Generation picks the model and preset; otherwise use the story's.
    const settings = useSettings.getState();
    const connected = settings.loreGenModel && store.models.some((m) => m.provider === settings.loreGenModel!.provider && m.id === settings.loreGenModel!.id);
    const model = connected ? settings.loreGenModel : store.resolveModel();
    const preset = store.allPresets().find((p) => p.id === settings.loreGenPresetId);
    if (!s || !model) return;
    setBusy(true);
    try {
      const req = buildLoreRequest(s, type, input, { includeMemory: ctx.memory, includeAN: ctx.an, includeStory: ctx.story, existing: continueText ? entry.text : undefined });
      let text = (await generateText({ model, ...req, maxTokens: 300, params: preset ? preset.params : { temperature: 0.9 } }, undefined, (partial) => onResult(continueText ? `${entry.text}${partial}` : partial))).trim();
      if (continueText) text = `${entry.text}${entry.text.endsWith(' ') ? '' : ' '}${text}`;
      onResult(text);
      history.unshift(text);
      history.length = Math.min(history.length, 50);
      force((n) => n + 1);
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ background: 'var(--bg1)', padding: 14, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <div style={{ width: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('Generation Type')}</div>
          <Select value={type} onChange={setType} options={LORE_GEN_TYPES.map((x) => ({ value: x, label: t(x) }))} />
        </div>
        <div className="grow">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('Input Text')}</div>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('A name or short description, (tags in parentheses)')} />
        </div>
      </div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('Add Context')}:</span>
        <Checkbox on={ctx.memory} onChange={(v) => setCtx({ ...ctx, memory: v })} label={t('Memory')} />
        <Checkbox on={ctx.an} onChange={(v) => setCtx({ ...ctx, an: v })} label={t("Author's Note")} />
        <Checkbox on={ctx.story} onChange={(v) => setCtx({ ...ctx, story: v })} label={t('Story')} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy || !input.trim()} onClick={() => void run(false)}>
          {busy ? <span className="spinner" /> : null} {t('Generate')}
        </button>
        <button type="button" className="btn" disabled={busy || !entry.text} onClick={() => void run(true)}>
          {t('Continue')}
        </button>
        {history.length > 0 && (
          <div style={{ marginLeft: 'auto', width: 220 }}>
            <Select value={null} placeholder={t('Generation History')} onChange={(v) => onResult(history[Number(v)])} options={history.map((h, i) => ({ value: String(i), label: h.slice(0, 60) }))} />
          </div>
        )}
      </div>
    </div>
  );
}
