import { useEffect, useRef, useState } from 'react';
import { LORE_GEN_TYPES, buildLoreRequest, searchLore, type LoreEntry } from '@novelwriter/core';
import { generateText } from '../../api.ts';
import { useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Checkbox, Select } from '../../components/ui.tsx';


/** Last 50 generations, kept in this browser. */
const HISTORY_KEY = 'nw-lore-gen-history';
function loadHistory(): { type: string; input: string; text: string; time: number }[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveHistory(h: { type: string; input: string; text: string; time: number }[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
  } catch {
    /* storage unavailable */
  }
}

export function LoreGenerator({ entry, onResult, autoType }: { entry: LoreEntry; onResult: (text: string) => void; autoType?: string }) {
  const [type, setType] = useState<string>(autoType ?? 'General');
  const [customType, setCustomType] = useState('');
  const [history, setHistory] = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [entryQuery, setEntryQuery] = useState('');
  const others = useStory((s) => s.current?.lorebook.entries.filter((e) => e.id !== entry.id) ?? []);
  const [input, setInput] = useState(entry.displayName);
  const [ctx, setCtx] = useState({ memory: false, an: false, story: false });
  const [busy, setBusy] = useState(false);
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
      const kind = type === '__custom' ? customType.trim() || 'General' : type;
      const req = buildLoreRequest(s, kind, input, { includeMemory: ctx.memory, includeAN: ctx.an, includeStory: ctx.story, entryIds, existing: continueText ? entry.text : undefined });
      let text = (await generateText({ model, ...req, maxTokens: 300, params: preset ? preset.params : { temperature: 0.9 } }, undefined, (partial) => onResult(continueText ? `${entry.text}${partial}` : partial))).trim();
      if (continueText) text = `${entry.text}${entry.text.endsWith(' ') ? '' : ' '}${text}`;
      onResult(text);
      const next = [{ type: type === '__custom' ? customType : type, input, text, time: Date.now() }, ...loadHistory()].slice(0, 50);
      saveHistory(next);
      setHistory(next);
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  // "Generate Lore…" from the editor's context menu starts right away.
  const started = useRef(false);
  useEffect(() => {
    if (autoType && !started.current) {
      started.current = true;
      void run(false);
    }
  }, [autoType]);

  return (
    <div style={{ background: 'var(--bg1)', padding: 14, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <div style={{ width: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('Generation Type')}</div>
          <Select value={type} onChange={setType} ariaLabel={t('Generation Type')} options={[...LORE_GEN_TYPES.map((x) => ({ value: x as string, label: t(x) })), { value: '__custom', label: t('Custom…') }]} />
          {type === '__custom' && <input className="input" style={{ marginTop: 6 }} value={customType} placeholder={t('e.g. Spell, Starship, Recipe')} aria-label={t('Custom type')} onChange={(e) => setCustomType(e.target.value)} />}
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
      {others.length > 0 && (
        <div className="lore-gen-entries">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('Other entries')}:</span>
          {entryIds.map((id) => {
            const e = others.find((x) => x.id === id);
            return e ? (
              <span key={id} className="key-chip">
                {e.displayName || t('Unnamed Entry')}
                <button type="button" aria-label={t('Remove')} onClick={() => setEntryIds(entryIds.filter((x) => x !== id))}>
                  ×
                </button>
              </span>
            ) : null;
          })}
          <span className="lore-gen-search">
            <input className="input" value={entryQuery} placeholder={t('Search entries by key or name')} aria-label={t('Add entry as context')} onChange={(e) => setEntryQuery(e.target.value)} />
            {entryQuery.trim() && (
              <span className="excerpt-pop" style={{ bottom: 'auto', top: 'calc(100% + 4px)' }}>
                {searchLore(others, entryQuery)
                  .filter((e) => !entryIds.includes(e.id))
                  .slice(0, 8)
                  .map((e) => (
                    <button
                      type="button"
                      className="item"
                      key={e.id}
                      onClick={() => {
                        setEntryIds([...entryIds, e.id]);
                        setEntryQuery('');
                      }}
                    >
                      {e.displayName || t('Unnamed Entry')} <span style={{ opacity: 0.6, fontSize: 12 }}>{e.keys.slice(0, 3).join(', ')}</span>
                    </button>
                  ))}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy || !input.trim()} onClick={() => void run(false)}>
          {busy ? <span className="spinner" /> : null} {t('Generate')}
        </button>
        <button type="button" className="btn" disabled={busy || !entry.text} onClick={() => void run(true)}>
          {t('Continue')}
        </button>
        <span className="grow" />
        <button type="button" className="link-btn" onClick={() => useUI.getState().open('settings', { tab: 'defaults' })} title={t('Model and preset used for lore generation (Settings → Defaults)')}>
          {t('Change Settings')}
        </button>
        <button type="button" className="link-btn" disabled={!history.length} aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
          {t('History')} ({history.length})
        </button>
      </div>
      {showHistory && (
        <div className="lore-gen-history">
          {history.map((h, i) => (
            <button type="button" key={h.time + ':' + i} className="item" onClick={() => onResult(h.text)} title={t('Use this text')}>
              <span className="lore-gen-history-meta">
                {t(h.type) || h.type} · {h.input}
              </span>
              <span>{h.text}</span>
            </button>
          ))}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              saveHistory([]);
              setHistory([]);
              setShowHistory(false);
            }}
          >
            {t('Clear History')}
          </button>
        </div>
      )}
    </div>
  );
}
