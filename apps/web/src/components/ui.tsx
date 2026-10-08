import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, CaretUp, Check, Question, X } from '@phosphor-icons/react';
import { t } from '../i18n.ts';

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      <span className="knob">{on ? <Check weight="bold" size={10} /> : <X weight="bold" size={10} />}</span>
    </button>
  );
}

export function Checkbox({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="row" style={{ cursor: 'pointer', fontSize: 14 }}>
      <button type="button" className={`checkbox ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
        {on && <Check weight="bold" size={14} />}
      </button>
      <span>{label}</span>
    </label>
  );
}

/** A labeled setting row with a toggle, as used in settings and side panels. */
export function ToggleRow({ title, desc, on, onChange, disabled }: { title: ReactNode; desc?: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="toggle-row">
      <div className="row between">
        <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
        <Toggle on={on} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : undefined} />
      </div>
      {desc && <div className="desc" style={{ marginTop: 4 }}>{desc}</div>}
    </div>
  );
}

/**
 * Slider block in the original style: "Title / description / <inline number><suffix> ... Default: x / range".
 * The value is always an inline editable number (bold, no box). `small` renders the compact
 * "Label: value ⓘ" variant used for samplers.
 */
export function SliderSetting({
  title,
  desc,
  value,
  min,
  max,
  step,
  def,
  onChange,
  prefix,
  suffix,
  note,
  defText,
  small,
  disabled,
  help,
}: {
  title: ReactNode;
  desc?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  def?: number;
  onChange: (v: number) => void;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Extra text after the value, e.g. "[0] (off)". */
  note?: ReactNode;
  defText?: string;
  small?: boolean;
  disabled?: boolean;
  help?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
    setDraft(null);
  };
  return (
    <div className={`slider-setting ${small ? 'small' : ''}`} style={disabled ? { opacity: 0.55 } : undefined}>
      {!small && <div className="heading">{title}</div>}
      {!small && desc && <div className="desc">{desc}</div>}
      <div className="slider-head">
        <div className="slider-value">
          {small && <span className="slider-label">{title}:</span>}
          {prefix}
          <input
            className="slider-number"
            type="text"
            inputMode="decimal"
            value={shown}
            disabled={disabled}
            aria-label={typeof title === 'string' ? `${title} value` : undefined}
            style={{ width: `${Math.max(1, shown.length) + 0.4}ch` }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
          {suffix && <span className="slider-suffix">{suffix}</span>}
          {note && <span className="slider-note">{note}</span>}
          {help && (
            <span title={help} className="slider-help">
              <Question size={13} />
            </span>
          )}
        </div>
        {def !== undefined && (
          <button type="button" className="slider-default" onClick={() => onChange(def)} title={t('Reset')}>
            {defText ?? t('Default: {v}', { v: def })}
          </button>
        )}
      </div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={typeof title === 'string' ? title : undefined}
      />
    </div>
  );
}

export interface SelectOption<V extends string> {
  value: V;
  label: ReactNode;
  group?: string;
  description?: ReactNode;
  /** Thumbnail shown at the left of rich options (model pickers). */
  image?: ReactNode;
}

/** Custom dropdown styled like the original (react-select look). */
export function Select<V extends string>({
  value,
  options,
  onChange,
  placeholder,
  style,
  searchable,
  ariaLabel,
  rich,
  className = '',
}: {
  value: V | null;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
  placeholder?: string;
  style?: CSSProperties;
  searchable?: boolean;
  ariaLabel?: string;
  /** Rich mode: image strip + name in the box, image + name + description in the menu. */
  rich?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k, true);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k, true);
    };
  }, [open]);
  const cur = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => `${o.value} ${typeof o.label === 'string' ? o.label : ''} ${o.group ?? ''}`.toLowerCase().includes(q.toLowerCase())) : options;
  let lastGroup: string | undefined;
  return (
    <div className={`select-wrap ${rich ? 'rich' : ''} ${open ? 'open' : ''} ${className}`} ref={ref} style={style}>
      <button type="button" className="select-box" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
        {rich && cur?.image && <span className="select-thumb">{cur.image}</span>}
        <span className="select-current">{cur ? cur.label : <span className="select-placeholder">{placeholder}</span>}</span>
        <span className="select-caret">{open ? <CaretUp weight="bold" size={16} /> : <CaretDown weight="bold" size={16} />}</span>
      </button>
      {open && (
        <div className="select-menu" role="listbox">
          {searchable && (
            <input autoFocus className="input select-search" placeholder={t('Search')} value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {filtered.map((o) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={o.value}>
                {header && <div className="select-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`select-option ${o.value === value ? 'active' : ''} ${rich ? 'rich' : ''}`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {rich && o.image && <span className="select-option-thumb">{o.image}</span>}
                  <span className="select-option-text">
                    <span className="select-option-label">{o.label}</span>
                    {o.description && <span className="select-option-desc">{o.description}</span>}
                  </span>
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="select-option muted">—</div>}
        </div>
      )}
    </div>
  );
}

let modalSeq = 0;
const modalStack: number[] = [];

export function Modal({
  onClose,
  children,
  width = 760,
  className = '',
  label,
  noPad,
  height,
  docked,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  className?: string;
  label?: string;
  noPad?: boolean;
  height?: number | string;
  /** Side panel at the right edge; the rest of the app stays usable. */
  docked?: boolean;
}) {
  // Only the topmost modal answers Escape (a confirmation can open over another modal).
  const id = useRef(0);
  if (!id.current) id.current = ++modalSeq;
  useEffect(() => {
    const me = id.current;
    modalStack.push(me);
    return () => void modalStack.splice(modalStack.indexOf(me), 1);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id.current) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return createPortal(
    <div className={`modal-backdrop fade-in ${docked ? 'docked' : ''}`} onMouseDown={(e) => !docked && e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} style={{ width, height, padding: noPad ? 0 : undefined }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
  icon,
  children,
  plain,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  icon?: ReactNode;
  children?: ReactNode;
  /** White title instead of the heading colour (Story Statistics, Context Viewer). */
  plain?: boolean;
}) {
  return (
    <div className="modal-header">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          {icon}
          <h3 className={`modal-title ${plain ? 'plain' : ''}`}>{title}</h3>
        </div>
        {subtitle && <div className="modal-subtitle">{subtitle}</div>}
      </div>
      <div className="row" style={{ gap: 12, alignSelf: 'flex-start' }}>
        {children}
        <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label={t('Close')}>
          <X size={24} weight="bold" />
        </button>
      </div>
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = true, right, className = 'sub-heading' }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible">
      <div className="row between">
        <button type="button" className={`row collapsible-title ${className}`} style={{ gap: 6 }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {title}
          {open ? <CaretUp weight="fill" size={12} /> : <CaretDown weight="fill" size={12} />}
        </button>
        {right}
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

/** Text input that commits on Enter (used for keys, stop sequences, bias phrases). */
export function EnterInput({ placeholder, onSubmit, ariaLabel }: { placeholder: string; onSubmit: (v: string) => void; ariaLabel?: string }) {
  const [v, setV] = useState('');
  const submit = () => {
    if (v.trim()) onSubmit(v);
    setV('');
  };
  return (
    <div className="enter-input">
      <input
        className="input"
        value={v}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="button" className="enter-input-btn" onClick={submit} aria-label={t('Add')}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>
      </button>
    </div>
  );
}

export function NumberField({ label, value, onChange, step = 1, min, max, help }: { label: ReactNode; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; help?: string }) {
  return (
    <label className="number-field">
      <span className="row" style={{ gap: 4, fontSize: 14, fontWeight: 600 }}>
        {label}
        {help && (
          <span title={help} style={{ opacity: 0.6, display: 'inline-flex' }}>
            <Question size={13} />
          </span>
        )}
      </span>
      <input className="input" type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  );
}

export function SegmentedControl<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: ReactNode }[]; onChange: (v: V) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button type="button" key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<V extends string>({ value, tabs, onChange, className = '' }: { value: V; tabs: { value: V; label: ReactNode; ariaLabel?: string }[]; onChange: (v: V) => void; className?: string }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          key={tab.value}
          aria-selected={tab.value === value}
          aria-label={tab.ariaLabel}
          className={`tab ${tab.value === value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('a few seconds ago');
  if (s < 120) return t('a minute ago');
  if (s < 3600) return t('{n} minutes ago', { n: Math.floor(s / 60) });
  if (s < 7200) return t('an hour ago');
  if (s < 86400) return t('{n} hours ago', { n: Math.floor(s / 3600) });
  if (s < 172800) return t('a day ago');
  if (s < 86400 * 30) return t('{n} days ago', { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString();
}
