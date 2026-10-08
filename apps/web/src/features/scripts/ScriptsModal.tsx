import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ArrowsLeftRight, DownloadSimple, Plus, Trash, UploadSimple } from '@phosphor-icons/react';
import { uid, type UserScript } from '@novelwriter/core';
import { download, safeFileName, useStory } from '../../store/story.ts';
import { useSettings } from '../../store/settings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Modal, ModalHeader, Select, Tabs, Toggle } from '../../components/ui.tsx';
import { clearLogs, isRunning, restartScript, scriptsDisabled, updateScript, useScripts, type Scope } from './host.ts';
import { configValues, parseMeta, PERMISSIONS, type ConfigField } from './meta.ts';
import { EXAMPLES, NEW_SCRIPT } from './examples.ts';

/** Shown the first time User Scripts is opened; the answer is kept in settings. */
function ScriptsNotice({ onClose }: { onClose: () => void }) {
  const set = useSettings((s) => s.set);
  return (
    <Modal onClose={onClose} width="min(1360px, calc(100vw - 32px))" height="calc(100vh - 68px)" label={t('Some notes about user scripts.')} className="scripts-notice">
      <div className="scripts-notice-body">
        <h2>{t('Some notes about user scripts.')}</h2>
        <p>{t('User scripts are custom JavaScript that can modify and extend NovelWriter. They can hook generations, rewrite text and add new behaviour. They are useful, but keep a few things in mind when using them.')}</p>
        <h3>{t('Security')}</h3>
        <p>{t('Only use scripts from sources you trust. Each script runs in its own sandbox that cannot reach the network, your AI providers or the rest of the page. Through the script API it can still read your story and, with the permissions you grant, change it. A malicious script could at the very least annoy you, and at worst corrupt your data. Be cautious.')}</p>
        <h3>{t('Performance Impact')}</h3>
        <p>{t('Poorly written scripts can slow down generation or the editor. If you notice performance issues, try disabling your scripts to see if that helps. Add ?noscript=true to the address to start with every script turned off.')}</p>
        <h3>{t('Support')}</h3>
        <p>{t('Problems caused by user scripts are outside what this project can help with. Keep backups of stories you care about before trying new scripts.')}</p>
        <p className="strong">{t('By using user scripts, you acknowledge that you understand these risks and agree to use them responsibly.')}</p>
        <div className="row" style={{ justifyContent: 'center', gap: 20 }}>
          <button type="button" className="btn" onClick={() => set({ userScriptsAccepted: true })}>
            {t('Got it')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              set({ userScriptsAccepted: false });
              onClose();
            }}
          >
            {t('No thanks')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ScriptsModal({ onClose }: { onClose: () => void }) {
  const accepted = useSettings((s) => s.userScriptsAccepted);
  if (!accepted) return <ScriptsNotice onClose={onClose} />;
  return <ScriptsEditor onClose={onClose} />;
}

type Tab = 'info' | 'code' | 'config' | 'storage' | 'logs' | 'diagnostics';
type Selected = { scope: Scope; id: string } | null;

/** `.nwscript` export: our own small JSON wrapper around the code. */
function exportScript(s: UserScript) {
  download(`${safeFileName(s.name)}.nwscript`, JSON.stringify({ format: 'novelwriter-script', version: 1, name: s.name, language: s.language ?? 'js', code: s.code }, null, 2));
}

function scriptFromFile(name: string, text: string): UserScript {
  const base = { id: uid(), enabled: false, granted: [] as string[] };
  try {
    const j = JSON.parse(text) as { format?: string; name?: string; code?: string; language?: 'js' | 'ts' };
    if (j.format === 'novelwriter-script' && typeof j.code === 'string') return { ...base, name: j.name ?? name, code: j.code, language: j.language ?? 'js' };
  } catch {
    /* plain source */
  }
  return { ...base, name: parseMeta(text).meta.name ?? name.replace(/\.[^.]+$/, ''), code: text, language: /\.ts$/i.test(name) ? 'ts' : 'js' };
}

function ScriptsEditor({ onClose }: { onClose: () => void }) {
  const storyScripts = useStory((s) => s.current?.scripts ?? []);
  const accountScripts = useSettings((s) => s.accountScripts);
  const [sel, setSel] = useState<Selected>(storyScripts[0] ? { scope: 'story', id: storyScripts[0].id } : accountScripts[0] ? { scope: 'account', id: accountScripts[0].id } : null);
  const [tab, setTab] = useState<Tab>('code');
  const [draft, setDraft] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ui = useUI.getState();
  const list = (scope: Scope) => (scope === 'story' ? storyScripts : accountScripts);
  const script = sel ? list(sel.scope).find((s) => s.id === sel.id) : undefined;
  const dirty = draft !== null && script !== undefined && draft !== script.code;

  const guard = async (): Promise<boolean> =>
    !dirty || (await ui.confirm({ title: t('Discard unsaved changes?'), message: t('The code of "{name}" has changes that are not saved.', { name: script!.name }), confirmLabel: t('Discard'), danger: true }));
  const select = async (next: Selected) => {
    if (!(await guard())) return;
    setDraft(null);
    setSel(next);
  };
  const close = async () => {
    if (await guard()) onClose();
  };
  const add = (scope: Scope, s: UserScript) => {
    if (scope === 'account') useSettings.getState().set({ accountScripts: [...useSettings.getState().accountScripts, s] });
    else useStory.getState().update((st) => void (st.scripts = [...st.scripts, s]));
    setDraft(null);
    setSel({ scope, id: s.id });
  };
  const remove = async (scope: Scope, s: UserScript) => {
    if (!(await ui.confirm({ title: t('Delete Script?'), message: s.name, danger: true, confirmLabel: t('Delete') }))) return;
    if (scope === 'account') useSettings.getState().set({ accountScripts: useSettings.getState().accountScripts.filter((x) => x.id !== s.id) });
    else useStory.getState().update((st) => void (st.scripts = st.scripts.filter((x) => x.id !== s.id)));
    setSel(null);
    setDraft(null);
  };
  const move = (scope: Scope, s: UserScript) => {
    const to: Scope = scope === 'story' ? 'account' : 'story';
    if (scope === 'account') useSettings.getState().set({ accountScripts: useSettings.getState().accountScripts.filter((x) => x.id !== s.id) });
    else useStory.getState().update((st) => void (st.scripts = st.scripts.filter((x) => x.id !== s.id)));
    add(to, s);
  };

  const Section = ({ scope, title }: { scope: Scope; title: string }) => (
    <>
      <div className="scripts-group">{title}</div>
      {list(scope).map((s) => (
        <div key={s.id} className={`scripts-item ${sel?.id === s.id && sel.scope === scope ? 'active' : ''}`} onClick={() => void select({ scope, id: s.id })}>
          <span className="grow">{s.name}</span>
          <span onClick={(e) => e.stopPropagation()}>
            <Toggle on={s.enabled} onChange={(v) => updateScript(scope, s.id, (x) => ({ ...x, enabled: v }))} label={s.name} />
          </span>
        </div>
      ))}
      {list(scope).length === 0 && <div className="muted scripts-none">{scope === 'story' ? t('No scripts in this story.') : t('No account scripts.')}</div>}
    </>
  );

  return (
    <Modal onClose={() => void close()} width={1100} height="min(800px, calc(100vh - 32px))" label={t('User Scripts')} className="scripts-modal">
      <ModalHeader title={t('User Scripts')} onClose={() => void close()} />
      {scriptsDisabled && <div className="warning-text" style={{ marginBottom: 10 }}>{t('Scripts are turned off for this page (?noscript=true).')}</div>}
      <div className="scripts-layout">
        <div className="scripts-side">
          <Section scope="story" title={t('Story Scripts')} />
          <Section scope="account" title={t('Account Scripts')} />
          <div className="scripts-side-actions">
            <button type="button" className="btn small" onClick={() => add('story', { id: uid(), name: t('New Script'), enabled: false, code: NEW_SCRIPT, language: 'js', granted: [] })}>
              <Plus size={14} weight="bold" /> {t('New Script')}
            </button>
            <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
              <UploadSimple size={14} /> {t('Import')}
            </button>
            <Select
              value={null}
              placeholder={t('Add an example…')}
              ariaLabel={t('Add an example')}
              onChange={(name) => {
                const ex = EXAMPLES.find((e) => e.name === name);
                if (ex) add('story', { id: uid(), name: ex.name, enabled: false, code: ex.code, language: ex.language, granted: [] });
              }}
              options={EXAMPLES.map((e) => ({ value: e.name, label: e.name }))}
            />
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".nwscript,.js,.ts,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) add('story', scriptFromFile(f.name, await f.text()));
              }}
            />
          </div>
        </div>
        <div className="scripts-main">
          {script && sel ? (
            <>
              <div className="row" style={{ gap: 8 }}>
                <input className="input grow" value={script.name} aria-label={t('Script name')} onChange={(e) => updateScript(sel.scope, script.id, (x) => ({ ...x, name: e.target.value }))} />
                <button type="button" className="icon-btn" title={sel.scope === 'story' ? t('Move to Account Scripts') : t('Move to Story Scripts')} aria-label={t('Move script')} onClick={() => move(sel.scope, script)}>
                  <ArrowsLeftRight size={18} />
                </button>
                <button type="button" className="icon-btn" title={t('Export')} aria-label={t('Export')} onClick={() => exportScript(script)}>
                  <DownloadSimple size={18} />
                </button>
                <button type="button" className="icon-btn" title={t('Delete')} aria-label={t('Delete Script')} onClick={() => void remove(sel.scope, script)}>
                  <Trash size={18} />
                </button>
              </div>
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'info', label: t('Info') },
                  { value: 'code', label: dirty ? `${t('Code')} •` : t('Code') },
                  { value: 'config', label: t('Config') },
                  { value: 'storage', label: t('Storage') },
                  { value: 'logs', label: t('Logs') },
                  { value: 'diagnostics', label: t('Diagnostics') },
                ]}
              />
              <div className="scripts-tab">
                {tab === 'info' && <InfoTab scope={sel.scope} script={script} />}
                {tab === 'code' && <CodeTab scope={sel.scope} script={script} draft={draft} setDraft={setDraft} />}
                {tab === 'config' && <ConfigTab scope={sel.scope} script={script} />}
                {tab === 'storage' && <StorageTab scope={sel.scope} script={script} />}
                {tab === 'logs' && <LogsTab scriptKey={`${sel.scope}:${script.id}`} />}
                {tab === 'diagnostics' && <DiagnosticsTab scriptKey={`${sel.scope}:${script.id}`} enabled={script.enabled} />}
              </div>
            </>
          ) : (
            <div className="empty-state">{t('Scripts can hook generations, edit the story and lorebook, add buttons, panels and windows, and decorate the editor. Pick an example on the left to see how.')}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function InfoTab({ scope, script }: { scope: Scope; script: UserScript }) {
  const { meta, error } = useMemo(() => parseMeta(script.code), [script.code]);
  return (
    <div className="scripts-info">
      {error && <div className="warning-text">{error}</div>}
      <dl>
        <dt>{t('Description')}</dt>
        <dd>{meta.description || '—'}</dd>
        <dt>{t('Author')}</dt>
        <dd>{meta.author || '—'}</dd>
        <dt>{t('Version')}</dt>
        <dd>{meta.version || '—'}</dd>
        <dt>{t('Runs in')}</dt>
        <dd>{scope === 'story' ? t('This story') : t('Every story')}</dd>
      </dl>
      <div className="heading" style={{ marginTop: 12 }}>{t('Permissions')}</div>
      {meta.permissions.length === 0 && <div className="desc">{t('This script asks for no permissions. It can read the story but not change it.')}</div>}
      {meta.permissions.map((p) => {
        const granted = script.granted?.includes(p);
        return (
          <div key={p} className="row between scripts-perm">
            <span>
              <code>{p}</code> — {t(PERMISSIONS[p])}
            </span>
            {granted ? (
              <button type="button" className="btn small" onClick={() => updateScript(scope, script.id, (x) => ({ ...x, granted: (x.granted ?? []).filter((g) => g !== p) }))}>
                {t('Revoke')}
              </button>
            ) : (
              <span className="muted">{t('Asked on first use')}</span>
            )}
          </div>
        );
      })}
      <div className="heading" style={{ marginTop: 16 }}>{t('API')}</div>
      <pre className="scripts-api">{API_SUMMARY}</pre>
    </div>
  );
}

const API_SUMMARY = `api.v1.hooks.register(name, fn)       onScriptsLoaded, onGenerationRequested({ cancel }), onBeforeContextBuild,
                                      onContextBuilt({ system, context }), onResponse({ text }), onGenerationEnd({ text }),
                                      onLorebookEntrySelected({ entryId }), onTextAdventureInput({ text, mode }),
                                      onHistoryNavigated({ action, nodeId })
api.v1.document   text() paragraphs() insertParagraph(i, text) updateParagraph(i, text) removeParagraph(i)
                  append(text) replace(from, to, text) undo() redo()                         [documentEdit]
api.v1.editor     selection() generate() isGenerating() decorations.setRules/setMarkers/clear  [editorDecorations]
api.v1.generate({ prompt | messages, system, maxTokens, temperature })   generateWithStory({ instruction })
api.v1.story      get() set({ title, description, memory, authorsNote, systemPrompt, prefill, tags })  [storyEdit]
api.v1.params     get() set(partial)                                                         [presetEdit]
api.v1.lorebook   entries() entry(id) categories() create(p) update(id, p) remove(id)        [lorebookEdit]
api.v1.tokenizer  count(text) encode(text) decode(ids)        api.v1.tts  speak(text) stop()
api.v1.storage / storyStorage / historyStorage / tempStorage   get(key, fallback) set(key, v) remove(key) list()
api.v1.random     int(a, b) float() pick(list) dice('2d6+1')   api.v1.timers.sleep(ms)
api.v1.messaging  send(channel, data) on(channel, fn)         api.v1.config.get(id)
api.v1.ui         toast(text) register({ type, id, … }) update(id, patch) remove(id) modal.open/update/close
                  types: contextMenuButton, toolbarButton, toolboxOption, sidebarPanel, lorebookPanel
                  parts: row column box text button textInput numberInput checkbox slider select collapsible
api.v1.clipboard.write(text) [clipboardWrite]   api.v1.file.download(name, text) [fileDownload]
api.v1.hypebot.comment(text)   api.v1.log(...)   api.v1.error(...)
Limits: 5 s per hook (outside API calls), 20 generations a minute, 3 without user interaction, 1 MB storage.`;

function CodeTab({ scope, script, draft, setDraft }: { scope: Scope; script: UserScript; draft: string | null; setDraft: (v: string | null) => void }) {
  const code = draft ?? script.code;
  const dirty = draft !== null && draft !== script.code;
  const lines = code.split('\n').length;
  const save = () => {
    updateScript(scope, script.id, (x) => ({ ...x, code }));
    setDraft(null);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="scripts-code">
      <div className="row" style={{ gap: 8 }}>
        <Select
          style={{ width: 160 }}
          value={script.language ?? 'js'}
          ariaLabel={t('Language')}
          onChange={(v) => updateScript(scope, script.id, (x) => ({ ...x, language: v }))}
          options={[
            { value: 'js', label: 'JavaScript' },
            { value: 'ts', label: 'TypeScript' },
          ]}
        />
        <span className="grow muted" style={{ fontSize: 12 }}>
          {lines} {t('lines')}
          {dirty ? ` · ${t('Unsaved changes')}` : ''}
        </span>
        <button type="button" className="btn small" disabled={!dirty} onClick={() => setDraft(null)}>
          {t('Revert')}
        </button>
        <button type="button" className="btn small primary" disabled={!dirty} onClick={save} title="Ctrl+S">
          {t('Save')}
        </button>
      </div>
      <textarea className="textarea code" spellCheck={false} value={code} aria-label={t('Script')} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const el = e.currentTarget;
          const a = el.selectionStart;
          const next = `${code.slice(0, a)}  ${code.slice(el.selectionEnd)}`;
          setDraft(next);
          requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
        }
      }} />
    </div>
  );
}

function ConfigTab({ scope, script }: { scope: Scope; script: UserScript }) {
  const { meta } = useMemo(() => parseMeta(script.code), [script.code]);
  const values = configValues(meta, script.config);
  const set = (id: string, v: unknown) => updateScript(scope, script.id, (x) => ({ ...x, config: { ...(x.config ?? {}), [id]: v } }));
  if (!meta.config.length) return <div className="desc">{t('This script has no settings. Scripts declare them in the "config" list of their @meta block.')}</div>;
  return (
    <div className="scripts-config">
      {meta.config.map((f: ConfigField) => (
        <label key={f.id} className="number-field">
          <span style={{ fontWeight: 600 }}>{f.label || f.id}</span>
          {f.description && <span className="desc">{f.description}</span>}
          {f.type === 'boolean' ? (
            <Toggle on={Boolean(values[f.id])} onChange={(v) => set(f.id, v)} label={f.label} />
          ) : f.type === 'number' ? (
            <input className="input" type="number" min={f.min} max={f.max} value={Number(values[f.id] ?? 0)} onChange={(e) => set(f.id, Number(e.target.value))} />
          ) : f.type === 'select' ? (
            <Select value={String(values[f.id] ?? '')} onChange={(v) => set(f.id, v)} options={(f.options ?? []).map((o) => ({ value: String(o.value), label: String(o.label) }))} />
          ) : f.type === 'text' ? (
            <textarea className="textarea" value={String(values[f.id] ?? '')} onChange={(e) => set(f.id, e.target.value)} />
          ) : (
            <input className="input" value={String(values[f.id] ?? '')} onChange={(e) => set(f.id, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

function StorageTab({ scope, script }: { scope: Scope; script: UserScript }) {
  const scriptData = useSettings((s) => s.scriptStorage[script.id]);
  const storyData = useStory((s) => s.current?.scriptStorage?.[script.id]);
  const clear = (which: 'script' | 'story') => {
    if (which === 'script') {
      const all = { ...useSettings.getState().scriptStorage };
      delete all[script.id];
      useSettings.getState().set({ scriptStorage: all });
    } else
      useStory.getState().update((s) => {
        const all = { ...(s.scriptStorage ?? {}) };
        delete all[script.id];
        s.scriptStorage = all;
      });
  };
  void scope;
  return (
    <div className="scripts-storage">
      <div className="row between">
        <span className="heading">{t('Script Storage')}</span>
        <button type="button" className="btn small" disabled={!scriptData} onClick={() => clear('script')}>
          {t('Clear')}
        </button>
      </div>
      <div className="desc">{t('api.v1.storage — kept for this script in every story.')}</div>
      <pre className="ctx-text">{scriptData ? JSON.stringify(scriptData, null, 2) : '—'}</pre>
      <div className="row between">
        <span className="heading">{t('Story Storage')}</span>
        <button type="button" className="btn small" disabled={!storyData} onClick={() => clear('story')}>
          {t('Clear')}
        </button>
      </div>
      <div className="desc">{t('api.v1.storyStorage and historyStorage — kept with this story.')}</div>
      <pre className="ctx-text">{storyData ? JSON.stringify(storyData, null, 2) : '—'}</pre>
    </div>
  );
}

function LogsTab({ scriptKey }: { scriptKey: string }) {
  const logs = useScripts((s) => s.logs[scriptKey]) ?? [];
  return (
    <div className="scripts-logs">
      <div className="row between">
        <span className="desc">{t('{n} lines', { n: logs.length })}</span>
        <button type="button" className="btn small" disabled={!logs.length} onClick={() => clearLogs(scriptKey)}>
          {t('Clear')}
        </button>
      </div>
      <pre className="ctx-text">
        {logs.length
          ? logs.map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'log-error' : ''}>
                [{new Date(l.time).toLocaleTimeString()}] {l.text}
              </div>
            ))
          : '—'}
      </pre>
    </div>
  );
}

function DiagnosticsTab({ scriptKey, enabled }: { scriptKey: string; enabled: boolean }) {
  const d = useScripts((s) => s.diagnostics[scriptKey]);
  const running = isRunning(scriptKey);
  return (
    <div className="scripts-diag">
      <dl>
        <dt>{t('Status')}</dt>
        <dd>{!enabled ? t('Disabled') : !running ? t('Not running') : d ? t(d.status === 'ready' ? 'Running' : d.status === 'error' ? 'Error' : 'Loading') : '—'}</dd>
        {d?.error && (
          <>
            <dt>{t('Error')}</dt>
            <dd className="log-error">{d.error}</dd>
          </>
        )}
        <dt>{t('Hooks')}</dt>
        <dd>{d?.hooks.length ? d.hooks.join(', ') : '—'}</dd>
        <dt>{t('Load time')}</dt>
        <dd>{d ? `${d.loadMs} ms` : '—'}</dd>
        <dt>{t('Hook calls')}</dt>
        <dd>{d && Object.keys(d.hookCalls).length ? Object.entries(d.hookCalls).map(([k, v]) => `${k} ×${v}`).join(', ') : '—'}</dd>
        <dt>{t('Time in hooks')}</dt>
        <dd>{d ? `${d.hookMs} ms` : '—'}</dd>
        <dt>{t('API calls')}</dt>
        <dd>{d?.rpcCalls ?? 0}</dd>
        <dt>{t('Generations')}</dt>
        <dd>{d?.generations ?? 0}</dd>
        <dt>{t('Restarts')}</dt>
        <dd>{d?.restarts ?? 0}</dd>
      </dl>
      <button type="button" className="btn small" disabled={!running} onClick={() => restartScript(scriptKey)}>
        <ArrowClockwise size={14} /> {t('Restart Script')}
      </button>
    </div>
  );
}
