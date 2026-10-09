import { useEffect, useState, type ReactNode } from 'react';
import { ArrowsClockwise, Check, DownloadSimple, Play, Stop, Trash, X } from '@phosphor-icons/react';
import {
  EMBEDDING_MODELS,
  ENDPOINT_PRESETS,
  activeEmbeddingModel,
  llamaVariants,
  type EmbeddingConfig,
  type EmbeddingConfigPatch,
  type EmbeddingModelInfo,
  type OnnxDevice,
  type OnnxDtype,
} from '@novelwriter/core';
import { api, type EmbeddingStatus, type EmbeddingTask, type HardwareInfo } from '../../api.ts';
import { useEmbeddings } from '../../store/embeddings.ts';
import { useUI } from '../../store/ui.ts';
import { t } from '../../i18n.ts';
import { Checkbox, SegmentedControl, Select, ToggleRow } from '../../components/ui.tsx';

const DTYPES: OnnxDtype[] = ['fp32', 'fp16', 'int8', 'uint8', 'quantized', 'q4', 'q4f16', 'bnb4'];
const DTYPE_LABELS: Record<OnnxDtype, string> = {
  fp32: 'FP32 (full precision)',
  fp16: 'FP16 (half precision, GPUs)',
  int8: 'INT8 (quantized, CPUs)',
  uint8: 'UINT8 (quantized)',
  quantized: 'Quantized (8-bit, dynamic)',
  q4: 'Q4 (4-bit weights)',
  q4f16: 'Q4F16 (4-bit weights, FP16)',
  bnb4: 'BNB4 (4-bit NF4)',
};
const LANG = { zh: 'Chinese', en: 'English', multi: 'Multilingual' } as const;

const toast = (msg: string, kind: 'error' | 'success' | 'info' = 'error') => useUI.getState().toast(msg, kind);
const run = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    toast((e as Error).message);
  }
};

function Group({ title, desc, children, wide }: { title: string; desc?: ReactNode; children: ReactNode; wide?: boolean }) {
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

function Label({ text, help }: { text: string; help?: string }) {
  return (
    <span className="field-label" style={{ margin: 0 }}>
      {t(text)}
      {help && <span className="desc" style={{ fontWeight: 400, display: 'block', marginTop: 2 }}>{t(help)}</span>}
    </span>
  );
}

function Num({ label, help, value, onChange, min, max, step = 1 }: { label: string; help?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
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

function Text({ label, help, value, onChange, placeholder, multiline, password }: { label: string; help?: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; password?: boolean }) {
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

function Pick<V extends string>({ label, help, value, options, onChange }: { label: string; help?: string; value: V; options: { value: V; label: string; description?: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="number-field">
      <Label text={label} help={help} />
      <Select value={value} ariaLabel={t(label)} searchable={options.length > 10} onChange={onChange} options={options.map((o) => ({ ...o, label: t(o.label), description: o.description ? t(o.description) : undefined }))} />
    </div>
  );
}

function mb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`;
}

function TaskRow({ task }: { task: EmbeddingTask }) {
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

function Hardware({ hw, onRefresh }: { hw: HardwareInfo | null; onRefresh: () => void }) {
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

const ONNX_DEVICES: { value: OnnxDevice; label: string; description: string; os?: string[]; arch?: string[] }[] = [
  { value: 'auto', label: 'Automatic', description: 'The best provider the runtime offers on this system.' },
  { value: 'cpu', label: 'CPU', description: 'Works everywhere.' },
  { value: 'dml', label: 'DirectML (Windows GPU)', description: 'NVIDIA, AMD, Intel and Qualcomm GPUs on Windows.', os: ['win32'] },
  { value: 'cuda', label: 'CUDA (NVIDIA)', description: 'Needs the CUDA provider below, CUDA 12 and cuDNN 9.', os: ['linux'], arch: ['x64'] },
  { value: 'tensorrt', label: 'TensorRT (NVIDIA)', description: 'Needs TensorRT 10 as well; slow first start while it builds engines.', os: ['linux'], arch: ['x64'] },
  { value: 'coreml', label: 'Core ML (Apple GPU / Neural Engine)', description: 'Apple Silicon GPU and Neural Engine (NPU).', os: ['darwin'] },
  { value: 'webgpu', label: 'WebGPU (Dawn)', description: 'Vulkan, Metal or Direct3D 12 through WebGPU; any vendor.', os: ['win32', 'linux', 'darwin'] },
  { value: 'qnn', label: 'QNN (Qualcomm NPU)', description: 'Snapdragon Hexagon NPU. Needs an ONNX Runtime built with QNN (custom runtime below).' },
  { value: 'custom', label: 'Custom providers (JSON)', description: 'Any providers a custom ONNX Runtime build supports.' },
];

function OnnxSection({ c, save, status, hw }: { c: EmbeddingConfig; save: (p: EmbeddingConfigPatch) => void; status: EmbeddingStatus | null; hw: HardwareInfo | null }) {
  const o = c.onnx;
  const rt = status?.runtime;
  const installed = new Map(status?.models.onnx.map((m) => [m.repo, m.dtypes]) ?? []);
  const catalog = EMBEDDING_MODELS.filter((m) => m.onnx);
  const current = catalog.find((m) => m.id === o.model);
  const repo = current?.onnx?.repo ?? o.model;
  const dtype: OnnxDtype = o.dtype === 'auto' ? (current?.onnx?.recommended ?? 'fp32') : o.dtype;
  const devices = ONNX_DEVICES.filter((d) => !hw || ((!d.os || d.os.includes(hw.os)) && (!d.arch || d.arch.includes(hw.arch))));
  const onnx = (p: Partial<EmbeddingConfig['onnx']>) => save({ onnx: p });
  return (
    <>
      <Group title="ONNX Runtime" desc={t('Runs the model inside NovelWriter. The runtime (about 60–90 MB) is downloaded from the npm registry when you install it; nothing is downloaded until then.')}>
        <div style={{ gridColumn: '1 / -1' }} className="row between">
          <span>
            {rt?.installed ? (
              <>
                <Check size={14} /> {rt.version} · {mb(rt.sizeMB)}
              </>
            ) : (
              t('Not installed')
            )}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => void run(api.installRuntime('onnx'))}>
              <DownloadSimple size={14} /> {rt?.installed ? t('Reinstall') : t('Install')}
            </button>
            {rt?.installed && (
              <button type="button" className="btn small" onClick={() => void run(api.removeRuntime('onnx'))}>
                <Trash size={14} /> {t('Remove')}
              </button>
            )}
          </span>
        </div>
        {rt?.installed && rt.cudaAvailable && (
          <div style={{ gridColumn: '1 / -1' }} className="row between">
            <span>
              {t('CUDA / TensorRT providers')}: {rt.cudaProviders ? t('Installed') : t('Not installed')}
              <span className="desc" style={{ display: 'block' }}>{t("About 240 MB from Microsoft's NuGet package. Also needs CUDA 12 and cuDNN 9 on the system.")}</span>
            </span>
            {rt.cudaProviders ? (
              <button type="button" className="btn small" onClick={() => void run(api.removeRuntime('onnx-cuda'))}>
                <Trash size={14} /> {t('Remove')}
              </button>
            ) : (
              <button type="button" className="btn small" onClick={() => void run(api.installRuntime('onnx-cuda'))}>
                <DownloadSimple size={14} /> {t('Install')}
              </button>
            )}
          </div>
        )}
      </Group>

      <Group title="Model" wide>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {catalog.map((m) => {
            const have = installed.get(m.onnx!.repo) ?? [];
            const dt = m.id === o.model ? dtype : m.onnx!.recommended;
            const size = m.onnx!.sizes[dt];
            const selected = m.id === o.model;
            return (
              <div key={m.id} className="row between" style={{ padding: '8px 10px', background: selected ? 'var(--bg2)' : 'var(--bg0)', gap: 12 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>{' '}
                  <span className="desc">
                    · {t(LANG[m.lang])} · {m.dims}d · {m.maxTokens} {t('tokens')}
                    {size ? ` · ${dt} ${mb(size)}` : ''}
                  </span>
                  {m.note && <span className="desc" style={{ display: 'block', fontSize: 12 }}>{t(m.note)}</span>}
                  {have.length > 0 && <span className="desc" style={{ display: 'block', fontSize: 12 }}>{t('Downloaded')}: {have.join(', ')}</span>}
                </span>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  {!have.includes(dt) ? (
                    <button type="button" className="btn small" onClick={() => void run(api.downloadModel({ kind: 'onnx', repo: m.id, dtype: dt }))}>
                      <DownloadSimple size={14} /> {t('Download')}
                    </button>
                  ) : (
                    <button type="button" className="btn small" title={t('Delete')} aria-label={t('Delete')} onClick={() => void run(api.deleteModel({ kind: 'onnx', repo: m.onnx!.repo, dtype: dt }))}>
                      <Trash size={14} />
                    </button>
                  )}
                  <button type="button" className={`btn small ${selected ? 'primary' : ''}`} onClick={() => onnx({ model: m.id })}>
                    {selected ? t('In Use') : t('Use')}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </Group>
      <Group title="Model Options">
        <Text
          label="Other Model"
          help="Any Hugging Face repo in the transformers.js layout (an onnx/ folder), e.g. Xenova/bge-small-en-v1.5."
          value={current ? '' : o.model}
          placeholder="Org/model-name"
          onChange={(v) => v.trim() && onnx({ model: v.trim() })}
        />
        {!current && o.model && (
          <div className="number-field">
            <Label text="Download" help={o.model} />
            <button type="button" className="btn" onClick={() => void run(api.downloadModel({ kind: 'onnx', repo, dtype }))}>
              <DownloadSimple size={14} /> {t('Download')} ({dtype})
            </button>
          </div>
        )}
        <Pick
          label="Precision"
          help="Which quantization of the model to run. INT8 suits CPUs; FP16 and Q4F16 suit GPUs."
          value={o.dtype}
          onChange={(v) => onnx({ dtype: v })}
          options={[
            { value: 'auto', label: `Recommended (${current?.onnx?.recommended ?? 'fp32'})` },
            ...DTYPES.filter((d) => !current || current.onnx?.sizes[d]).map((d) => ({ value: d, label: DTYPE_LABELS[d], description: current?.onnx?.sizes[d] ? mb(current.onnx.sizes[d]!) : undefined })),
          ]}
        />
      </Group>

      <Group title="Hardware Acceleration" desc={t('Execution providers ONNX Runtime runs the model on. Providers the stock runtime does not include need a custom ONNX Runtime build.')}>
        <Pick label="Execution Provider" value={o.device} onChange={(v) => onnx({ device: v })} options={devices} />
        {(o.device === 'dml' || o.device === 'cuda' || o.device === 'tensorrt') && <Num label="Device ID" help="Index of the GPU to use (0 = first)." value={o.deviceId} min={0} max={16} onChange={(v) => onnx({ deviceId: v })} />}
        {o.device === 'coreml' && (
          <>
            <Pick
              label="Compute Units"
              value={o.coremlUnits}
              onChange={(v) => onnx({ coremlUnits: v })}
              options={[
                { value: 'all', label: 'All (CPU, GPU and Neural Engine)' },
                { value: 'ane', label: 'Neural Engine only' },
                { value: 'cpu-gpu', label: 'CPU and GPU' },
                { value: 'cpu', label: 'CPU only' },
              ]}
            />
            <div className="number-field" style={{ gap: 8 }}>
              <Checkbox on={o.coremlMlProgram} onChange={(v) => onnx({ coremlMlProgram: v })} label={t('ML Program format (newer, recommended)')} />
              <Checkbox on={o.coremlStaticShapes} onChange={(v) => onnx({ coremlStaticShapes: v })} label={t('Only static input shapes')} />
              <Checkbox on={o.coremlSubgraphs} onChange={(v) => onnx({ coremlSubgraphs: v })} label={t('Run subgraphs on Core ML')} />
            </div>
          </>
        )}
        {o.device === 'qnn' && (
          <>
            <Pick
              label="QNN Backend"
              value={o.qnnBackend}
              onChange={(v) => onnx({ qnnBackend: v })}
              options={[
                { value: 'htp', label: 'HTP (Hexagon NPU)' },
                { value: 'gpu', label: 'GPU (Adreno)' },
                { value: 'cpu', label: 'CPU' },
              ]}
            />
            <Text label="QNN Backend Library" help="Path to QnnHtp.dll / libQnnHtp.so; overrides the backend above." value={o.qnnBackendPath} onChange={(v) => onnx({ qnnBackendPath: v })} />
            <ToggleRow title={t('FP16 Precision')} on={o.qnnFp16} onChange={(v) => onnx({ qnnFp16: v })} />
          </>
        )}
        {o.device === 'webgpu' && (
          <Pick
            label="Preferred Layout"
            value={o.webgpuLayout}
            onChange={(v) => onnx({ webgpuLayout: v })}
            options={[
              { value: 'NCHW', label: 'NCHW' },
              { value: 'NHWC', label: 'NHWC' },
            ]}
          />
        )}
        {o.device === 'custom' && (
          <Text
            multiline
            label="Execution Providers (JSON)"
            help='Passed to ONNX Runtime as executionProviders, e.g. [{"name":"qnn","backendType":"htp"},"cpu"].'
            value={o.customProviders}
            placeholder='[{"name":"qnn","backendType":"htp"},"cpu"]'
            onChange={(v) => onnx({ customProviders: v })}
          />
        )}
        <Text
          label="Custom ONNX Runtime"
          help="Folder of an onnxruntime-node package built with more providers (QNN for Snapdragon, …). Empty = the installed runtime."
          value={o.customRuntime}
          onChange={(v) => onnx({ customRuntime: v })}
        />
        {o.device !== 'cpu' && o.device !== 'auto' && <ToggleRow title={t('CPU Fallback')} desc={t('Operators the chosen provider cannot run go to the CPU.')} on={o.cpuFallback} onChange={(v) => onnx({ cpuFallback: v })} />}
      </Group>

      <Group title="Runtime Tuning">
        <Num label="Intra-op Threads" help="Threads within an operator (0 = automatic)." value={o.intraOpThreads} min={0} max={256} onChange={(v) => onnx({ intraOpThreads: v })} />
        <Num label="Inter-op Threads" help="Threads across operators in parallel mode (0 = automatic)." value={o.interOpThreads} min={0} max={256} onChange={(v) => onnx({ interOpThreads: v })} />
        <Pick
          label="Graph Optimization"
          value={o.graphOptimization}
          onChange={(v) => onnx({ graphOptimization: v })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'extended', label: 'Extended' },
            { value: 'basic', label: 'Basic' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        <Pick
          label="Execution Mode"
          value={o.executionMode}
          onChange={(v) => onnx({ executionMode: v })}
          options={[
            { value: 'sequential', label: 'Sequential' },
            { value: 'parallel', label: 'Parallel' },
          ]}
        />
        <ToggleRow title={t('CPU Memory Arena')} desc={t('Faster repeated runs, more memory held.')} on={o.memArena} onChange={(v) => onnx({ memArena: v })} />
        <ToggleRow title={t('Memory Pattern')} desc={t('Pre-plans memory for inputs of the same shape.')} on={o.memPattern} onChange={(v) => onnx({ memPattern: v })} />
        <Pick
          label="Log Level"
          value={String(o.logLevel) as '0'}
          onChange={(v) => onnx({ logLevel: Number(v) as 0 })}
          options={[
            { value: '0', label: 'Verbose' },
            { value: '1', label: 'Info' },
            { value: '2', label: 'Warning' },
            { value: '3', label: 'Error' },
            { value: '4', label: 'Fatal' },
          ]}
        />
      </Group>
    </>
  );
}

function LlamaSection({ c, save, status, hw }: { c: EmbeddingConfig; save: (p: EmbeddingConfigPatch) => void; status: EmbeddingStatus | null; hw: HardwareInfo | null }) {
  const l = c.llama;
  const llama = (p: Partial<EmbeddingConfig['llama']>) => save({ llama: p });
  const variants = hw ? llamaVariants(hw.os, hw.arch) : [];
  const builds = status?.llamaBuilds ?? [];
  const have = new Set(status?.models.gguf.map((g) => `${g.repo}/${g.file}`) ?? []);
  const catalog = EMBEDDING_MODELS.filter((m) => m.gguf);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState('');
  const st = status?.llama;
  const isPath = l.model.startsWith('path:');
  return (
    <>
      <Group title="llama.cpp Server" desc={t("NovelWriter downloads llama.cpp's prebuilt server for the build you pick and starts it when it is needed. Nothing is downloaded until you install it.")}>
        <Pick
          label="Binary"
          value={l.binary}
          onChange={(v) => llama({ binary: v })}
          options={[
            { value: 'managed', label: 'Downloaded by NovelWriter' },
            { value: 'custom', label: 'My own llama-server' },
          ]}
        />
        {l.binary === 'custom' ? (
          <Text label="llama-server Path" value={l.customBinary} placeholder="/usr/local/bin/llama-server" onChange={(v) => llama({ customBinary: v })} />
        ) : (
          <>
            <Pick
              label="Build"
              help="CPU works everywhere; pick the GPU or NPU backend of this computer for speed."
              value={l.variant}
              onChange={(v) => llama({ variant: v })}
              options={[{ value: 'auto', label: `Automatic (${hw?.suggest.llamaVariant ?? '…'})` }, ...variants.map((v) => ({ value: v.id, label: v.label, description: v.id }))]}
            />
            <Text label="Release" help="A llama.cpp release tag such as b6700, or latest." value={l.release} placeholder="latest" onChange={(v) => llama({ release: v.trim() || 'latest' })} />
            <Text label="GitHub Download Mirror" help="Prefix for GitHub downloads, e.g. https://ghfast.top/ (empty = direct)." value={l.mirror} onChange={(v) => llama({ mirror: v.trim() })} />
            <div className="number-field">
              <Label text="Installed Builds" />
              {builds.length === 0 && <span className="desc">{t('None')}</span>}
              {builds.map((b) => (
                <div key={b.dir} className="row between">
                  <span>
                    {b.tag} · {b.variant} · {mb(b.sizeMB)}
                  </span>
                  <button type="button" className="icon-btn" aria-label={t('Remove')} title={t('Remove')} onClick={() => void run(api.removeLlamaBuild(b.tag, b.variant))}>
                    <Trash size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn small" style={{ marginTop: 6 }} onClick={() => void run(api.installRuntime('llama'))}>
                <DownloadSimple size={14} /> {t('Install Selected Build')}
              </button>
            </div>
          </>
        )}
        <div className="number-field" style={{ gridColumn: '1 / -1' }}>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{t('Server')}:</span>
            <span>{st?.running ? `${t('Running')} · ${st.url}` : st?.starting ? t('Starting…') : t('Stopped')}</span>
            <span className="grow" />
            <button type="button" className="btn small" onClick={() => void run(api.llamaStart())}>
              <Play size={14} /> {t('Start')}
            </button>
            <button type="button" className="btn small" onClick={() => void run(api.llamaStop())}>
              <Stop size={14} /> {t('Stop')}
            </button>
            <button type="button" className="btn small" onClick={() => void api.llamaDevices().then((r) => setDevices(r.output), (e: Error) => setDevices(e.message))}>
              {t('List Devices')}
            </button>
          </div>
          {st?.error && <div className="warning-text">{st.error}</div>}
          {devices && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg0)', padding: 8, margin: 0 }}>{devices}</pre>}
          {st?.log && (
            <details>
              <summary className="desc">{t('Server Log')}</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 240, overflow: 'auto', background: 'var(--bg0)', padding: 8 }}>{st.log.slice(-6000)}</pre>
            </details>
          )}
        </div>
      </Group>

      <Group title="Model" wide>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {catalog.map((m) => {
            const files = m.gguf!.files;
            const quant = sel[m.id] ?? (l.model.startsWith(`${m.id}:`) ? l.model.split(':')[1] : m.gguf!.recommended);
            const file = files.find((f) => f.quant === quant) ?? files[0];
            const downloaded = have.has(`${m.gguf!.repo}/${file.file}`);
            const selected = l.model === `${m.id}:${file.quant}`;
            return (
              <div key={m.id} className="row between" style={{ padding: '8px 10px', background: selected ? 'var(--bg2)' : 'var(--bg0)', gap: 12 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>{' '}
                  <span className="desc">
                    · {t(LANG[m.lang])} · {m.dims}d · {m.maxTokens} {t('tokens')}
                  </span>
                  {m.note && <span className="desc" style={{ display: 'block', fontSize: 12 }}>{t(m.note)}</span>}
                </span>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <Select value={file.quant} ariaLabel={t('Quantization')} onChange={(v) => setSel({ ...sel, [m.id]: v })} options={files.map((f) => ({ value: f.quant, label: `${f.quant} · ${mb(f.mb)}` }))} style={{ minWidth: 150 }} />
                  {downloaded ? (
                    <button type="button" className="btn small" title={t('Delete')} aria-label={t('Delete')} onClick={() => void run(api.deleteModel({ kind: 'gguf', repo: m.gguf!.repo, file: file.file }))}>
                      <Trash size={14} />
                    </button>
                  ) : (
                    <button type="button" className="btn small" onClick={() => void run(api.downloadModel({ kind: 'gguf', model: m.id, quant: file.quant }))}>
                      <DownloadSimple size={14} /> {t('Download')}
                    </button>
                  )}
                  <button type="button" className={`btn small ${selected ? 'primary' : ''}`} onClick={() => llama({ model: `${m.id}:${file.quant}` })}>
                    {selected ? t('In Use') : t('Use')}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <Text label="Other GGUF File" help="Full path of any embedding model in GGUF format." value={isPath ? l.model.slice(5) : ''} placeholder="/path/to/model.gguf" onChange={(v) => v.trim() && llama({ model: `path:${v.trim()}` })} />
      </Group>

      <Group title="Server Options" desc={t('Passed to llama-server as command-line options.')}>
        <Num label="GPU Layers (-ngl)" help="Layers offloaded to the GPU; 999 = all, 0 = CPU only." value={l.gpuLayers} min={-1} max={999} onChange={(v) => llama({ gpuLayers: v })} />
        <Text label="Device (--device)" help="E.g. CUDA0, Vulkan1, SYCL0, ROCm0, none. Empty = default. See List Devices." value={l.device} onChange={(v) => llama({ device: v.trim() })} />
        <Pick
          label="Split Mode (-sm)"
          value={l.splitMode}
          onChange={(v) => llama({ splitMode: v })}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'none', label: 'None (one GPU)' },
            { value: 'layer', label: 'Layer' },
            { value: 'row', label: 'Row' },
          ]}
        />
        <Num label="Main GPU (-mg)" value={l.mainGpu} min={0} max={16} onChange={(v) => llama({ mainGpu: v })} />
        <Text label="Tensor Split (-ts)" help="GPU proportions, e.g. 3,1." value={l.tensorSplit} onChange={(v) => llama({ tensorSplit: v.trim() })} />
        <Num label="Threads (-t)" help="0 = automatic." value={l.threads} min={0} max={512} onChange={(v) => llama({ threads: v })} />
        <Num label="Batch Threads (-tb)" help="0 = same as threads." value={l.threadsBatch} min={0} max={512} onChange={(v) => llama({ threadsBatch: v })} />
        <Num label="Context Size (-c)" help="Shared by the parallel slots." value={l.ctxSize} min={0} max={262144} step={512} onChange={(v) => llama({ ctxSize: v })} />
        <Num label="Batch Size (-b)" value={l.batchSize} min={0} max={65536} step={64} onChange={(v) => llama({ batchSize: v })} />
        <Num label="Micro-batch Size (-ub)" help="Must hold a whole input for embedding models." value={l.ubatchSize} min={0} max={65536} step={64} onChange={(v) => llama({ ubatchSize: v })} />
        <Num label="Parallel Slots (-np)" value={l.parallel} min={0} max={64} onChange={(v) => llama({ parallel: v })} />
        <Pick
          label="Pooling (--pooling)"
          value={l.pooling}
          onChange={(v) => llama({ pooling: v })}
          options={[
            { value: 'auto', label: "Model's own" },
            { value: 'mean', label: 'Mean' },
            { value: 'cls', label: 'CLS' },
            { value: 'last', label: 'Last token' },
            { value: 'none', label: 'None' },
          ]}
        />
        <Pick
          label="Flash Attention (-fa)"
          value={l.flashAttn}
          onChange={(v) => llama({ flashAttn: v })}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
        <Num label="Port" help="0 = any free port." value={l.port} min={0} max={65535} onChange={(v) => llama({ port: v })} />
        <Num label="Stop When Idle (minutes)" help="0 = keep running." value={l.idleMinutes} min={0} max={1440} onChange={(v) => llama({ idleMinutes: v })} />
        <ToggleRow title={t('Lock in Memory (--mlock)')} on={l.mlock} onChange={(v) => llama({ mlock: v })} />
        <ToggleRow title={t('Memory-map Model (mmap)')} on={l.mmap} onChange={(v) => llama({ mmap: v })} />
        <Text label="Extra Arguments" help="Added to the command line as is." value={l.extraArgs} placeholder="--rope-scaling yarn" onChange={(v) => llama({ extraArgs: v })} />
        <Text
          multiline
          label="Environment Variables"
          help="NAME=value per line, e.g. CUDA_VISIBLE_DEVICES=1, GGML_VK_VISIBLE_DEVICES=0, HIP_VISIBLE_DEVICES=0, ONEAPI_DEVICE_SELECTOR=level_zero:0, GGML_OPENVINO_DEVICE=NPU (Intel NPU with the OpenVINO build)."
          value={l.env}
          onChange={(v) => llama({ env: v })}
        />
      </Group>
    </>
  );
}

function EndpointSection({ c, save }: { c: EmbeddingConfig; save: (p: EmbeddingConfigPatch) => void }) {
  const e = c.endpoint;
  const endpoint = (p: Partial<EmbeddingConfig['endpoint']>) => save({ endpoint: p });
  const preset = ENDPOINT_PRESETS.find((p) => p.id === e.preset);
  return (
    <Group title="Embedding Endpoint" desc={t('Any OpenAI-compatible /embeddings endpoint. Local servers keep the story on this computer; cloud services receive the story text.')}>
      <Pick
        label="Service"
        value={e.preset}
        onChange={(id) => {
          const p = ENDPOINT_PRESETS.find((x) => x.id === id)!;
          endpoint({ preset: id, ...(p.baseUrl ? { baseUrl: p.baseUrl, model: p.model } : {}) });
        }}
        options={ENDPOINT_PRESETS.map((p) => ({ value: p.id, label: p.local ? `${p.name} (${t('local')})` : p.name, description: p.note }))}
      />
      <Text label="Endpoint URL" value={e.baseUrl} placeholder="http://127.0.0.1:11434/v1" onChange={(v) => endpoint({ baseUrl: v.trim() })} />
      <Text label="API Key" password value={e.apiKey} placeholder={t('Not needed for most local servers')} onChange={(v) => endpoint({ apiKey: v })} />
      <Text label="Model" value={e.model} placeholder={preset?.model} onChange={(v) => endpoint({ model: v.trim() })} />
      <Pick
        label="Known Model"
        help="If the endpoint serves one of these, its query and passage prefixes are used."
        value={e.catalogModel}
        onChange={(v) => endpoint({ catalogModel: v })}
        options={[{ value: '', label: 'None / other' }, ...EMBEDDING_MODELS.map((m) => ({ value: m.id, label: m.name }))]}
      />
      <Num label="Dimensions" help="Output size for models that support it (0 = default)." value={e.dimensions} min={0} max={8192} onChange={(v) => endpoint({ dimensions: v })} />
      <Pick
        label="Encoding"
        value={e.encodingFormat}
        onChange={(v) => endpoint({ encodingFormat: v })}
        options={[
          { value: 'float', label: 'Float (JSON numbers)' },
          { value: 'base64', label: 'Base64 (smaller responses)' },
        ]}
      />
      <Num label="Concurrent Requests" value={e.concurrency} min={1} max={32} onChange={(v) => endpoint({ concurrency: v })} />
      <Num label="Timeout (ms)" value={e.timeoutMs} min={1000} max={600000} step={1000} onChange={(v) => endpoint({ timeoutMs: v })} />
      <Text multiline label="Extra Request Body (JSON)" help='Merged into every request, e.g. {"truncate": true}.' value={e.extraBody} onChange={(v) => endpoint({ extraBody: v })} />
      <Text multiline label="Extra Headers (JSON)" value={e.headers} placeholder='{"X-Api-Version": "2"}' onChange={(v) => endpoint({ headers: v })} />
    </Group>
  );
}

const HF_HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'];
const NPM_HOSTS = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];

export function EmbeddingsTab() {
  const c = useEmbeddings((s) => s.config);
  const save = (p: EmbeddingConfigPatch) => void useEmbeddings.getState().save(p).catch((e: Error) => toast(e.message));
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [test, setTest] = useState<string>('');
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void useEmbeddings.getState().load();
    void api.hardware().then(setHw, () => {});
  }, []);
  const busy = status?.tasks.some((x) => x.status === 'running') ?? false;
  useEffect(() => {
    let alive = true;
    const tick = () => void api.embeddingStatus().then((s) => alive && setStatus(s), () => {});
    tick();
    const timer = setInterval(tick, busy ? 700 : 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busy]);
  if (!c) return null;
  const model: EmbeddingModelInfo | undefined = activeEmbeddingModel(c);
  const tasks = status?.tasks.filter((x) => x.status === 'running' || Date.now() - x.startedAt < 120_000) ?? [];
  return (
    <>
      <Group title="Vector Search">
        <ToggleRow
          title={t('Recall by Meaning')}
          desc={
            c.enabled
              ? t('Stories with Recall Earlier Passages on also find earlier passages that are close in meaning to the latest text, not only ones that share words with it.')
              : t('Earlier passages are recalled by shared words only.')
          }
          on={c.enabled}
          onChange={(v) => save({ enabled: v })}
        />
        <div>
          <div className="heading" style={{ marginBottom: 8 }}>{t('Embedding Engine')}</div>
          <SegmentedControl
            value={c.source}
            onChange={(v) => save({ source: v })}
            options={[
              { value: 'onnx', label: t('Built-in (ONNX)') },
              { value: 'llamacpp', label: t('Built-in (llama.cpp)') },
              { value: 'endpoint', label: t('Endpoint') },
            ]}
          />
          <div className="desc" style={{ marginTop: 6 }}>
            {c.source === 'onnx'
              ? t('ONNX Runtime inside NovelWriter: CPU, DirectML, CUDA/TensorRT, Core ML (Apple Neural Engine), WebGPU, and Qualcomm QNN with a custom build.')
              : c.source === 'llamacpp'
                ? t("llama.cpp's server, run by NovelWriter: CPU, CUDA, Vulkan, ROCm, SYCL, OpenVINO (Intel GPU/NPU), Metal, Snapdragon. GGUF models.")
                : t('A server you run or a cloud service, including NPU runtimes such as FastFlowLM (AMD Ryzen AI) and OpenVINO Model Server (Intel).')}
          </div>
        </div>
      </Group>

      {tasks.length > 0 && (
        <Group title="Downloads">
          {tasks.map((x) => (
            <TaskRow key={x.id} task={x} />
          ))}
        </Group>
      )}

      <Group title="This Computer">
        <Hardware hw={hw} onRefresh={() => void api.hardware(true).then(setHw, () => {})} />
      </Group>

      {c.source === 'onnx' && <OnnxSection c={c} save={save} status={status} hw={hw} />}
      {c.source === 'llamacpp' && <LlamaSection c={c} save={save} status={status} hw={hw} />}
      {c.source === 'endpoint' && <EndpointSection c={c} save={save} />}

      <Group title="Check">
        <div style={{ gridColumn: '1 / -1' }} className="row" >
          <button
            type="button"
            className="btn"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setTest('');
              try {
                const r = await api.testEmbeddings();
                setTest(t('{dims} dimensions · 3 passages in {ms} ms · a query in {q} ms · related {r} vs unrelated {u}', { dims: r.dims, ms: r.ms, q: r.queryMs, r: r.related, u: r.unrelated }));
              } catch (e) {
                setTest(`✗ ${(e as Error).message}`);
              }
              setTesting(false);
            }}
          >
            {testing ? t('Testing…') : t('Test Embeddings')}
          </button>
          <span style={{ marginLeft: 12 }} className={test.startsWith('✗') ? 'warning-text' : 'desc'}>{test}</span>
        </div>
      </Group>

      <Group title="Model Input" desc={model ? `${model.name}: ${model.dims}d, ${model.maxTokens} ${t('tokens')}${model.mrl ? `, ${t('can be shortened to')} ${model.mrl.join('/')}` : ''}` : undefined}>
        <Num label="Batch Size" help="Passages per request while indexing." value={c.batchSize} min={1} max={512} onChange={(v) => save({ batchSize: v })} />
        <Num label="Max Input Length" help="Characters per passage or query sent to the model (0 = the model's limit, at most 1024)." value={c.maxTokens} min={0} max={32768} onChange={(v) => save({ maxTokens: v })} />
        <Pick
          label="Dimensions"
          help="Matryoshka models keep most of their quality at smaller sizes; smaller indexes search faster."
          value={String(c.dimensions)}
          onChange={(v) => save({ dimensions: Number(v) })}
          options={[{ value: '0', label: 'Full' }, ...(model?.mrl ?? []).filter((d) => d < (model?.dims ?? 0)).map((d) => ({ value: String(d), label: String(d) }))]}
        />
        <Pick
          label="Pooling"
          help="How token vectors become one vector (built-in ONNX engine)."
          value={c.pooling}
          onChange={(v) => save({ pooling: v })}
          options={[
            { value: 'auto', label: `Model's own${model ? ` (${model.pooling})` : ''}` },
            { value: 'cls', label: 'CLS (first token)' },
            { value: 'mean', label: 'Mean' },
            { value: 'last', label: 'Last token' },
          ]}
        />
        <Text label="Query Prefix" help="Put before each search query (some models are trained with one)." value={c.queryPrefix ?? model?.queryPrefix ?? ''} onChange={(v) => save({ queryPrefix: v })} />
        <Text label="Passage Prefix" help="Put before each passage when it is indexed." value={c.docPrefix ?? model?.docPrefix ?? ''} onChange={(v) => save({ docPrefix: v })} />
        <div>
          <button type="button" className="btn small" onClick={() => save({ queryPrefix: null, docPrefix: null })}>
            {t("Reset to the Model's Prefixes")}
          </button>
        </div>
      </Group>

      <Group title="Recall">
        <Num label="Candidates" help="Passages the vector search hands to the ranking." value={c.topK} min={1} max={200} onChange={(v) => save({ topK: v })} />
        <Num label="Minimum Similarity" help="Cosine similarity a passage needs (0–1)." value={c.minScore} min={0} max={1} step={0.01} onChange={(v) => save({ minScore: v })} />
        <Num label="Vector Weight" help="Weight of meaning against shared words when the two rankings are combined (1 = equal)." value={c.vectorWeight} min={0} max={10} step={0.1} onChange={(v) => save({ vectorWeight: v })} />
        <Num label="Query Length" help="Characters of the latest text used to search." value={c.queryChars} min={100} max={20000} step={100} onChange={(v) => save({ queryChars: v })} />
        <Num label="Search Timeout (ms)" help="Generation goes ahead with word matching only after this long." value={c.queryTimeoutMs} min={200} max={60000} step={100} onChange={(v) => save({ queryTimeoutMs: v })} />
        <ToggleRow title={t('Index Automatically')} desc={t('New text is indexed in the background after each generation.')} on={c.autoIndex} onChange={(v) => save({ autoIndex: v })} />
      </Group>

      <Group title="Downloads & Storage">
        <Pick label="Hugging Face Source" value={HF_HOSTS.includes(c.hfEndpoint) ? c.hfEndpoint : 'custom'} onChange={(v) => v !== 'custom' && save({ hfEndpoint: v })} options={[...HF_HOSTS.map((h) => ({ value: h, label: h })), { value: 'custom', label: 'Custom' }]} />
        <Text label="Hugging Face URL" value={c.hfEndpoint} onChange={(v) => save({ hfEndpoint: v.trim() })} />
        <Pick label="npm Registry" help="Where the ONNX runtime is downloaded from." value={NPM_HOSTS.includes(c.npmRegistry) ? c.npmRegistry : 'custom'} onChange={(v) => v !== 'custom' && save({ npmRegistry: v })} options={[...NPM_HOSTS.map((h) => ({ value: h, label: h })), { value: 'custom', label: 'Custom' }]} />
        <Text label="npm Registry URL" value={c.npmRegistry} onChange={(v) => save({ npmRegistry: v.trim() })} />
        <Text label="NuGet Feed" help="For the CUDA provider libraries." value={c.nugetFeed} onChange={(v) => save({ nugetFeed: v.trim() })} />
        <Text label="Models Folder" help={status?.modelsDir ?? ''} value={c.modelsDir} placeholder={status?.modelsDir} onChange={(v) => save({ modelsDir: v.trim() })} />
        <div className="number-field">
          <Label text="Disk Use" />
          <span>
            {t('Models')}: {mb(status?.models.totalMB ?? 0)} · {t('Runtime')}: {mb((status?.runtime.sizeMB ?? 0) + (status?.llamaBuilds.reduce((n, b) => n + b.sizeMB, 0) ?? 0))}
          </span>
        </div>
        <div className="number-field">
          <Label text="Story Indexes" help="Rebuilt as stories are written." />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (confirm(t('Delete the vector indexes of all stories?'))) void run(api.dropVectors().then(() => toast(t('Indexes deleted.'), 'success')));
            }}
          >
            <Trash size={14} /> {t('Delete All Indexes')}
          </button>
        </div>
      </Group>
    </>
  );
}
