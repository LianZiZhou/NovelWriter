import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, Copy, Key, Plus, SignIn, SignOut, Trash } from '@phosphor-icons/react';
import { api, openLogin, type CustomProvider, type LoginEvent, type LoginPrompt, type ProviderInfo } from '../../api.ts';
import { useStory } from '../../store/story.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Modal, ModalHeader } from '../../components/ui.tsx';

/** Providers whose OAuth sign-in users are most likely to want, shown first. */
const FEATURED = ['anthropic', 'openai-codex', 'github-copilot', 'openrouter', 'xai', 'google', 'openai', 'deepseek'];

interface LoginState {
  provider: ProviderInfo;
  type: 'oauth' | 'api_key';
}

/** Drives a server-side pi-ai login flow; renders prompts and notifications as they arrive. */
function LoginFlow({ state, onDone }: { state: LoginState; onDone: (ok: boolean) => void }) {
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [prompt, setPrompt] = useState<{ id: number; prompt: LoginPrompt } | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const conn = useRef<ReturnType<typeof openLogin> | null>(null);

  useEffect(() => {
    const c = openLogin(state.provider.id, state.type, (m) => {
      if (m.type === 'notify') {
        setEvents((e) => [...e, m.event]);
        if (m.event.type === 'auth_url') window.open(m.event.url, '_blank', 'noopener');
      } else if (m.type === 'prompt') {
        setPrompt({ id: m.id, prompt: m.prompt });
        setValue('');
      } else if (m.type === 'prompt_cancel') setPrompt((p) => (p?.id === m.id ? null : p));
      else if (m.type === 'done') {
        setDone(true);
        setPrompt(null);
      } else if (m.type === 'error') setError(m.message);
    });
    conn.current = c;
    return () => c.cancel();
  }, [state]);

  const submit = (v: string) => {
    if (!prompt) return;
    conn.current?.answer(prompt.id, v);
    setPrompt(null);
  };

  const authUrl = [...events].reverse().find((e): e is Extract<LoginEvent, { type: 'auth_url' }> => e.type === 'auth_url');
  const device = [...events].reverse().find((e): e is Extract<LoginEvent, { type: 'device_code' }> => e.type === 'device_code');
  const infos = events.filter((e) => e.type === 'info' || e.type === 'progress') as Extract<LoginEvent, { message: string }>[];

  return (
    <Modal onClose={() => onDone(done)} width={560} label={t('Sign in')}>
      <ModalHeader title={`${t('Sign in')} · ${state.type === 'oauth' ? state.provider.oauth?.name : state.provider.apiKey?.name}`} onClose={() => onDone(done)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {done ? (
          <>
            <div style={{ color: 'var(--success)', fontWeight: 600 }}>{t('Login successful')}</div>
            <button type="button" className="btn primary" onClick={() => onDone(true)}>
              {t('Done')}
            </button>
          </>
        ) : error ? (
          <>
            <div className="warning-text">{error}</div>
            <button type="button" className="btn" onClick={() => onDone(false)}>
              {t('Close')}
            </button>
          </>
        ) : (
          <>
            {authUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {authUrl.instructions && <div className="desc">{authUrl.instructions}</div>}
                <a className="btn primary" href={authUrl.url} target="_blank" rel="noopener noreferrer">
                  <ArrowSquareOut size={16} /> {t('Open login page')}
                </a>
                <button type="button" className="link-btn" onClick={() => void navigator.clipboard.writeText(authUrl.url)}>
                  <Copy size={14} /> {t('Copy link')}
                </button>
              </div>
            )}
            {device && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="desc">{t('Enter this code')}:</div>
                <div className="device-code">{device.userCode}</div>
                <a className="btn" href={device.verificationUri} target="_blank" rel="noopener noreferrer">
                  <ArrowSquareOut size={16} /> {device.verificationUri}
                </a>
              </div>
            )}
            {infos.map((e, i) => (
              <div key={i} className="desc">
                {e.message}
                {'links' in e &&
                  e.links?.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6 }}>
                      {l.label ?? l.url}
                    </a>
                  ))}
              </div>
            ))}
            {prompt ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(value);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <label style={{ fontWeight: 600, fontSize: 14 }}>{prompt.prompt.message}</label>
                {prompt.prompt.type === 'select' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {prompt.prompt.options.map((o) => (
                      <button type="button" key={o.id} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => submit(o.id)}>
                        <div>
                          <div>{o.label}</div>
                          {o.description && <div className="desc" style={{ fontWeight: 400 }}>{o.description}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <input
                      autoFocus
                      className="input"
                      type={prompt.prompt.type === 'secret' ? 'password' : 'text'}
                      placeholder={prompt.prompt.placeholder}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                    <button type="submit" className="btn primary">
                      {t('Continue')}
                    </button>
                  </>
                )}
              </form>
            ) : (
              !authUrl &&
              !device && (
                <div className="row desc">
                  <span className="spinner" /> {t('Waiting for you to finish logging in…')}
                </div>
              )
            )}
            {authUrl && !prompt && (
              <div className="row desc">
                <span className="spinner" /> {t('Waiting for you to finish logging in…')}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function CustomEndpoints({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<CustomProvider[]>([]);
  const [draft, setDraft] = useState<CustomProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const ui = useUI.getState();
  useEffect(() => {
    void api.customProviders().then(setList).catch(() => {});
  }, []);
  const save = async (next: CustomProvider[]) => {
    await api.saveCustomProviders(next);
    setList(await api.customProviders());
    onChanged();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="settings-group-title">{t('Custom OpenAI-compatible endpoint')}</div>
      <div className="desc">{t('Ollama, LM Studio, vLLM, llama.cpp, or any server with an OpenAI-compatible /v1 API.')}</div>
      {list.map((c) => (
        <div className="provider-row" key={c.id}>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div className="desc">{c.baseUrl} · {c.models.map((m) => m.id).join(', ')}</div>
          </div>
          <button type="button" className="btn small" onClick={() => setDraft({ ...c })}>
            {t('Edit')}
          </button>
          <button type="button" className="icon-btn" aria-label={t('Remove')} onClick={() => void save(list.filter((x) => x.id !== c.id))}>
            <Trash size={16} />
          </button>
        </div>
      ))}
      {draft ? (
        <div style={{ background: 'var(--bg1)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" placeholder={t('Name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder="http://localhost:11434/v1" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
          <input className="input" type="password" placeholder={`${t('API Key')} (${t('optional')})`} value={draft.apiKey ?? ''} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
          <div className="row">
            <input
              className="input grow"
              placeholder={t('Models (comma separated)')}
              value={draft.models.map((m) => m.id).join(', ')}
              onChange={(e) => setDraft({ ...draft, models: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((id) => ({ id })) })}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !draft.baseUrl}
              onClick={async () => {
                setBusy(true);
                try {
                  const models = await api.probeCustom(draft.baseUrl, draft.apiKey, draft.id);
                  setDraft({ ...draft, models });
                } catch (e) {
                  ui.toast((e as Error).message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Fetch models')}
            </button>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!draft.name || !draft.baseUrl || !draft.models.length}
              onClick={async () => {
                const next = draft.id ? list.map((x) => (x.id === draft.id ? draft : x)) : [...list, draft];
                await save(next);
                setDraft(null);
              }}
            >
              {t('Save')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setDraft({ id: '', name: '', baseUrl: '', apiKey: '', models: [] })}>
          <Plus size={14} weight="bold" /> {t('Add endpoint')}
        </button>
      )}
    </div>
  );
}

export function ProvidersTab() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [q, setQ] = useState('');
  const [login, setLogin] = useState<LoginState | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const ui = useUI.getState();
  const refresh = async () => {
    try {
      setProviders(await api.providers());
    } catch {
      ui.toast(t('Server unreachable'), 'error');
    }
    await useStory.getState().refreshModels();
  };
  useEffect(() => {
    void refresh();
  }, []);
  const sorted = [...providers].filter((p) => !p.custom).sort((a, b) => {
    const fa = FEATURED.indexOf(a.id);
    const fb = FEATURED.indexOf(b.id);
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb) || a.name.localeCompare(b.name);
  });
  const filtered = q ? sorted.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q.toLowerCase())) : sorted;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="desc">
        {t('Sign in with your subscription (OAuth) or paste an API key. Credentials are stored on your NovelWriter server, never in the browser.')}
      </div>
      <input className="input" placeholder={t('Search providers')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((p) => (
          <div key={p.id}>
            <div className="provider-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span className={`status ${p.configured ? 'on' : 'off'}`}>{p.configured ? t('Connected') : t('Not connected')}</span>
                </div>
                <div className="desc" style={{ fontSize: 12 }}>
                  {p.modelCount} {t('Models')}
                  {p.source ? ` · ${p.source}` : ''}
                  {p.error ? ` · ${p.error}` : ''}
                </div>
              </div>
              {p.id !== 'demo' && (
                <>
                  {p.oauth && (
                    <button type="button" className="btn small primary" onClick={() => setLogin({ provider: p, type: 'oauth' })} title={p.oauth.name}>
                      <SignIn size={14} /> {p.oauth.label ?? t('Sign in')}
                    </button>
                  )}
                  {p.apiKey && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        if (p.apiKey?.interactive && !['openai', 'anthropic', 'google', 'deepseek', 'openrouter', 'xai', 'groq', 'mistral'].includes(p.id)) setLogin({ provider: p, type: 'api_key' });
                        else {
                          setKeyFor(keyFor === p.id ? null : p.id);
                          setKey('');
                        }
                      }}
                    >
                      <Key size={14} /> {t('API Key')}
                    </button>
                  )}
                  {p.stored && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('Sign out')}
                      title={t('Sign out')}
                      onClick={async () => {
                        await api.logout(p.id);
                        await refresh();
                      }}
                    >
                      <SignOut size={18} />
                    </button>
                  )}
                </>
              )}
            </div>
            {keyFor === p.id && (
              <form
                className="row"
                style={{ padding: 8, background: 'var(--bg1)' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api.setKey(p.id, key);
                    setKeyFor(null);
                    await refresh();
                    ui.toast(t('Saved'), 'success');
                  } catch (err) {
                    ui.toast((err as Error).message, 'error');
                  }
                }}
              >
                <input autoFocus className="input grow" type="password" placeholder={p.apiKey?.name} value={key} onChange={(e) => setKey(e.target.value)} />
                <button type="submit" className="btn primary" disabled={!key.trim()}>
                  {t('Save')}
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
      <CustomEndpoints onChanged={() => void refresh()} />
      {login && (
        <LoginFlow
          state={login}
          onDone={(ok) => {
            setLogin(null);
            if (ok) void refresh();
          }}
        />
      )}
    </div>
  );
}
