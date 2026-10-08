import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { uid } from '@novelwriter/core';
import { useStory } from '../../store/story.ts';
import { t } from '../../i18n.ts';
import { Modal, ModalHeader, Toggle } from '../../components/ui.tsx';
import { EXAMPLE_SCRIPT } from './runner.ts';
import { useSettings } from '../../store/settings.ts';

/** Shown the first time User Scripts is opened; the answer is kept in settings. */
function ScriptsNotice({ onClose }: { onClose: () => void }) {
  const set = useSettings((s) => s.set);
  return (
    <Modal onClose={onClose} width="min(1360px, calc(100vw - 32px))" height="calc(100vh - 68px)" label={t('Some notes about user scripts.')} className="scripts-notice">
      <div className="scripts-notice-body">
        <h2>{t('Some notes about user scripts.')}</h2>
        <p>{t('User scripts are custom JavaScript that can modify and extend NovelWriter. They can hook generations, rewrite text and add new behaviour. They are useful, but keep a few things in mind when using them.')}</p>
        <h3>{t('Security')}</h3>
        <p>{t('Only use scripts from sources you trust. Scripts run in a sandboxed worker without access to your providers or network, but they can still change your stories. A malicious script could at the very least annoy you, and at worst corrupt your data. Be cautious.')}</p>
        <h3>{t('Performance Impact')}</h3>
        <p>{t('Poorly written scripts can slow down generation or the editor. If you notice performance issues, try disabling your scripts to see if that helps.')}</p>
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

function ScriptsEditor({ onClose }: { onClose: () => void }) {
  const story = useStory((s) => s.current)!;
  const logs = useStory((s) => s.scriptLogs);
  const store = useStory.getState();
  const [sel, setSel] = useState(story.scripts[0]?.id ?? null);
  const script = story.scripts.find((s) => s.id === sel);
  const patch = (id: string, p: Partial<(typeof story.scripts)[number]>) => store.update((s) => void (s.scripts = s.scripts.map((x) => (x.id === id ? { ...x, ...p } : x))));
  return (
    <Modal onClose={onClose} width={1000} height="min(760px, calc(100vh - 32px))" label={t('User Scripts')}>
      <ModalHeader title={t('User Scripts')} onClose={onClose} />
      <div className="row" style={{ alignItems: 'stretch', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {story.scripts.map((s) => (
            <div key={s.id} className="provider-row" style={{ cursor: 'pointer', background: s.id === sel ? 'var(--bg3)' : undefined, padding: '8px 10px' }} onClick={() => setSel(s.id)}>
              <span className="grow" style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <Toggle on={s.enabled} onChange={(v) => patch(s.id, { enabled: v })} label={s.name} />
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => {
              const s = { id: uid(), name: t('New Script'), enabled: false, code: EXAMPLE_SCRIPT };
              store.update((st) => void (st.scripts = [...st.scripts, s]));
              setSel(s.id);
            }}
          >
            <Plus size={14} weight="bold" /> {t('Add')}
          </button>
        </div>
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {script ? (
            <>
              <div className="row">
                <input className="input grow" value={script.name} onChange={(e) => patch(script.id, { name: e.target.value })} aria-label={t('Name')} />
                <button type="button" className="icon-btn" style={{ width: 40 }} aria-label={t('Delete')} onClick={() => store.update((s) => void (s.scripts = s.scripts.filter((x) => x.id !== script.id)))}>
                  <Trash size={18} />
                </button>
              </div>
              <textarea className="textarea" spellCheck={false} style={{ flex: 1, fontFamily: 'var(--font-code)', fontSize: 13, resize: 'none' }} value={script.code} onChange={(e) => patch(script.id, { code: e.target.value })} aria-label={t('Script')} />
            </>
          ) : (
            <div className="empty-state">{t('Scripts can rewrite the context before it is sent and the AI response after it arrives. They run sandboxed in a web worker.')}</div>
          )}
          <div className="heading" style={{ fontSize: 14 }}>{t('Log')}</div>
          <pre className="ctx-text" style={{ minHeight: 80, maxHeight: 140, margin: 0, fontFamily: 'var(--font-code)', fontSize: 12 }}>{logs.join('\n') || '—'}</pre>
        </div>
      </div>
    </Modal>
  );
}
