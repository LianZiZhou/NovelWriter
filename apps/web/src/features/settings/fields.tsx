// Building blocks shared by the settings pages for local models (Vector Search, Text Analysis).
import { useState, type ReactNode } from 'react';
import { ArrowsClockwise, X } from '@phosphor-icons/react';
import { api, type EmbeddingTask, type HardwareInfo } from '../../api.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Select } from '../../components/ui.tsx';

export const toast = (msg: string, kind: 'error' | 'success' | 'info' = 'error') => useUI.getState().toast(msg, kind);
export const run = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    toast((e as Error).message);
  }
};

export function Group({ title, desc, children, wide }: { title: string; desc?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="settings-group-title">{t(title)}</div>
      {desc && <div className="desc" style={{ marginTop: -4, marginBottom: 12 }}>{desc}</div>}
      <div className={`settings-grid ${wide ? 'single' : ''}`} style={wide ? { gridTemplateColumns: '1fr' } : undefined}>
        {children}
      </div>
    </>
  );
}

export function Label({ text, help }: { text: string; help?: string }) {
  return (
    <span className="field-label" style={{ margin: 0 }}>
      {t(text)}
      {help && <span className="desc" style={{ fontWeight: 400, display: 'block', marginTop: 2 }}>{t(help)}</span>}
    </span>
  );
}

export function Num({ label, help, value, onChange, min, max, step = 1 }: { label: string; help?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    let v = parseFloat(draft);
    if (Number.isNaN(v)) v = value;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setDraft(null);
    if (v !== value) onChange(v);
  };
  return (
    <label className="number-field">
      <Label text={label} help={help} />
      <input className="input" type="number" value={draft ?? value} min={min} max={max} step={step} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

export function Text({ label, help, value, onChange, placeholder, multiline, password }: { label: string; help?: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; password?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };
  return (
    <label className="number-field" style={multiline ? { gridColumn: '1 / -1' } : undefined}>
      <Label text={label} help={help} />
      {multiline ? (
        <textarea className="textarea" style={{ minHeight: 70, fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }} value={draft ?? value} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input className="input" type={password ? 'password' : 'text'} value={draft ?? value} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      )}
    </label>
  );
}

export function Pick<V extends string>({ label, help, value, options, onChange }: { label: string; help?: string; value: V; options: { value: V; label: string; description?: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="number-field">
      <Label text={label} help={help} />
      <Select value={value} ariaLabel={t(label)} searchable={options.length > 10} onChange={onChange} options={options.map((o) => ({ ...o, label: t(o.label), description: o.description ? t(o.description) : undefined }))} />
    </div>
  );
}

export function mb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`;
}

export function TaskRow({ task }: { task: EmbeddingTask }) {
  const pct = task.total ? Math.min(100, Math.round((task.received / task.total) * 100)) : 0;
  return (
    <div style={{ gridColumn: '1 / -1', background: 'var(--bg0)', padding: '8px 12px' }}>
      <div className="row between">
        <span style={{ fontWeight: 600 }}>{task.label}</span>
        <span className="row" style={{ gap: 8 }}>
          <span className="desc">
            {task.status === 'running' ? `${pct}% · ${mb(task.received / 1048576)}${task.total ? ` / ${mb(task.total / 1048576)}` : ''}` : t(task.status === 'done' ? 'Done' : task.status === 'canceled' ? 'Canceled' : 'Failed')}
          </span>
          {task.status === 'running' && (
            <button type="button" className="icon-btn" aria-label={t('Cancel')} title={t('Cancel')} onClick={() => void run(api.cancelTask(task.id))}>
              <X size={14} />
            </button>
          )}
        </span>
      </div>
      {task.status === 'running' && (
        <div style={{ height: 4, background: 'var(--bg2)', marginTop: 6 }}>
          <div style={{ height: 4, width: `${pct}%`, background: 'var(--text-highlight, var(--accent))' }} />
        </div>
      )}
      {task.current && task.status === 'running' && <div className="desc" style={{ fontSize: 12, marginTop: 4 }}>{task.current}</div>}
      {task.error && <div className="warning-text" style={{ marginTop: 4 }}>{task.error}</div>}
    </div>
  );
}

export function Hardware({ hw, onRefresh }: { hw: HardwareInfo | null; onRefresh: () => void }) {
  if (!hw) return <div className="desc">{t('Detecting hardware…')}</div>;
  const line = (label: string, value: ReactNode) => (
    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontWeight: 600, minWidth: 90 }}>{t(label)}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {line('System', `${hw.os} ${hw.arch} · ${hw.cpu} · ${hw.cores} ${t('threads')} · ${hw.memoryGB} GB`)}
      {line('GPUs', hw.gpus.length ? hw.gpus.map((g) => `${g.name}${g.memoryMB ? ` (${mb(g.memoryMB)})` : ''}`).join(', ') : t('None found'))}
      {line('NPUs', hw.npus.length ? hw.npus.map((n) => n.name).join(', ') : t('None found'))}
      {hw.os === 'linux' && line('CUDA', `${t('Driver')} ${hw.cuda.driver ? '✓' : '✗'} · CUDA 12 ${hw.cuda.runtime12 ? '✓' : '✗'} · cuDNN 9 ${hw.cuda.cudnn9 ? '✓' : '✗'} · Vulkan ${hw.vulkan ? '✓' : '✗'}`)}
      {line('Suggested', `ONNX: ${hw.suggest.onnxDevice} · llama.cpp: ${hw.suggest.llamaVariant || '—'}`)}
      <div>
        <button type="button" className="btn small" onClick={onRefresh}>
          <ArrowsClockwise size={14} /> {t('Detect Again')}
        </button>
      </div>
    </div>
  );
}
