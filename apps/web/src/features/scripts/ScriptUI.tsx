import { memo, useState } from 'react';
import { Code } from '@phosphor-icons/react';
import { t } from '../../i18n.ts';
import { Collapsible, Modal, ModalHeader, Select, Toggle } from '../../components/ui.tsx';
import { invoke, useScripts, type Extension, type UIPart } from './host.ts';

/** Minimal Markdown for script text: **bold**, *italic*, `code`, line breaks. Everything is text, never HTML. */
function Markdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  text.split('\n').forEach((line, li) => {
    if (li) out.push(<br key={`br${li}`} />);
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    for (const m of line.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > last) out.push(line.slice(last, i));
      const s = m[0];
      if (s.startsWith('**')) out.push(<b key={`${li}:${i}`}>{s.slice(2, -2)}</b>);
      else if (s.startsWith('`')) out.push(<code key={`${li}:${i}`}>{s.slice(1, -1)}</code>);
      else out.push(<i key={`${li}:${i}`}>{s.slice(1, -1)}</i>);
      last = i + s.length;
    }
    if (last < line.length) out.push(line.slice(last));
  });
  return <>{out}</>;
}

/** Inputs keep their own value while typing; the script hears about every change. */
function TextField({ part, onChange }: { part: UIPart; onChange: (v: string) => void }) {
  const [v, setV] = useState(String(part.value ?? ''));
  const props = {
    className: part.multiline ? 'textarea' : 'input',
    value: v,
    placeholder: part.placeholder,
    'aria-label': part.label ?? part.placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setV(e.target.value);
      onChange(e.target.value);
    },
  };
  return part.multiline ? <textarea {...props} rows={4} /> : <input {...props} />;
}

const SAFE_STYLE = new Set(['gap', 'padding', 'margin', 'color', 'background', 'fontWeight', 'fontStyle', 'fontSize', 'textAlign', 'flex', 'width', 'maxWidth', 'opacity']);
const style = (s: UIPart['style']): React.CSSProperties | undefined =>
  s ? (Object.fromEntries(Object.entries(s).filter(([k, v]) => SAFE_STYLE.has(k) && !/url\s*\(/i.test(String(v)))) as React.CSSProperties) : undefined;

/** Render a script's UI parts; handlers call back into the script. */
export function Parts({ parts, scriptKey }: { parts: UIPart[] | undefined; scriptKey: string }) {
  if (!Array.isArray(parts)) return null;
  return (
    <>
      {parts.map((p, i) => (
        <Part key={p.id ?? i} part={p} scriptKey={scriptKey} />
      ))}
    </>
  );
}

function Part({ part: p, scriptKey }: { part: UIPart; scriptKey: string }) {
  const change = (v: unknown) => void invoke(scriptKey, p.onChange, v);
  switch (p.type) {
    case 'row':
    case 'column':
    case 'box':
      return (
        <div className={`sp-${p.type}`} style={style(p.style)}>
          <Parts parts={p.children} scriptKey={scriptKey} />
        </div>
      );
    case 'text':
      return <div className="sp-text" style={style(p.style)}>{p.markdown ? <Markdown text={String(p.text ?? '')} /> : String(p.text ?? '')}</div>;
    case 'button':
      return (
        <button type="button" className="btn small" style={style(p.style)} onClick={() => void invoke(scriptKey, p.onClick)}>
          {String(p.label ?? p.text ?? '')}
        </button>
      );
    case 'textInput':
      return (
        <label className="sp-field">
          {p.label && <span>{p.label}</span>}
          <TextField part={p} onChange={change} />
        </label>
      );
    case 'numberInput':
      return (
        <label className="sp-field">
          {p.label && <span>{p.label}</span>}
          <input className="input" type="number" defaultValue={Number(p.value ?? 0)} min={p.min} max={p.max} step={p.step} onChange={(e) => change(Number(e.target.value))} />
        </label>
      );
    case 'checkbox':
      return <CheckboxPart part={p} onChange={change} />;
    case 'slider':
      return <SliderPart part={p} onChange={change} />;
    case 'select':
      return <SelectPart part={p} onChange={change} />;
    case 'collapsible':
      return (
        <Collapsible title={String(p.title ?? p.label ?? '')} defaultOpen={p.open ?? false}>
          <Parts parts={p.children} scriptKey={scriptKey} />
        </Collapsible>
      );
  }
  return null;
}

function CheckboxPart({ part, onChange }: { part: UIPart; onChange: (v: boolean) => void }) {
  const [on, setOn] = useState(Boolean(part.value));
  return (
    <label className="row sp-check">
      <Toggle
        on={on}
        label={part.label}
        onChange={(v) => {
          setOn(v);
          onChange(v);
        }}
      />
      {part.label}
    </label>
  );
}

function SliderPart({ part, onChange }: { part: UIPart; onChange: (v: number) => void }) {
  const [v, setV] = useState(Number(part.value ?? part.min ?? 0));
  return (
    <label className="sp-field">
      <span>
        {part.label} <b>{v}</b>
      </span>
      <input
        type="range"
        min={part.min ?? 0}
        max={part.max ?? 100}
        step={part.step ?? 1}
        value={v}
        onChange={(e) => {
          setV(Number(e.target.value));
          onChange(Number(e.target.value));
        }}
      />
    </label>
  );
}

function SelectPart({ part, onChange }: { part: UIPart; onChange: (v: string) => void }) {
  const [v, setV] = useState(String(part.value ?? part.options?.[0]?.value ?? ''));
  return (
    <label className="sp-field">
      {part.label && <span>{part.label}</span>}
      <Select
        value={v}
        ariaLabel={part.label}
        onChange={(x) => {
          setV(x);
          onChange(x);
        }}
        options={(part.options ?? []).map((o) => ({ value: String(o.value), label: String(o.label) }))}
      />
    </label>
  );
}

/** Windows scripts open with `api.v1.ui.modal.open`. */
export function ScriptModals() {
  const modals = useScripts((s) => s.modals);
  return (
    <>
      {modals.map((m) => (
        <Modal key={m.key} width={m.size === 'large' ? 900 : m.size === 'small' ? 420 : 600} label={m.title} onClose={() => useScripts.setState({ modals: useScripts.getState().modals.filter((x) => x.key !== m.key) })}>
          <ModalHeader title={m.title} onClose={() => useScripts.setState({ modals: useScripts.getState().modals.filter((x) => x.key !== m.key) })} />
          <div className="modal-body script-parts">
            <Parts parts={m.content} scriptKey={m.scriptKey} />
          </div>
        </Modal>
      ))}
    </>
  );
}

export function useExtensions(type: Extension['type']): Extension[] {
  const all = useScripts((s) => s.extensions);
  return all.filter((e) => e.type === type);
}

/** Toolbar row of script buttons above the Send controls. */
export const ScriptToolbar = memo(function ScriptToolbar() {
  const buttons = useExtensions('toolbarButton');
  if (!buttons.length) return null;
  return (
    <div className="script-toolbar" role="toolbar" aria-label={t('Script buttons')}>
      <Code size={14} aria-hidden />
      {buttons.map((b) => (
        <button key={b.key} type="button" className="btn small" title={`${b.scriptName}: ${b.description ?? b.label ?? ''}`} onClick={() => void invoke(b.scriptKey, b.onClick)}>
          {b.label ?? b.id}
        </button>
      ))}
    </div>
  );
});

/** Sidebar panels registered by scripts (right sidebar, Scripts tab). */
export function ScriptPanels({ type = 'sidebarPanel' }: { type?: 'sidebarPanel' | 'lorebookPanel' }) {
  const panels = useExtensions(type);
  if (!panels.length) return <div className="muted" style={{ padding: 16, fontSize: 14 }}>{t('No script panels.')}</div>;
  return (
    <>
      {panels.map((p) => (
        <div key={p.key} className="panel-section script-panel">
          <div className="heading">{p.title ?? p.label ?? p.id}</div>
          <div className="script-parts">
            <Parts parts={p.content} scriptKey={p.scriptKey} />
          </div>
          <div className="desc" style={{ fontSize: 11 }}>{p.scriptName}</div>
        </div>
      ))}
    </>
  );
}
