// The ONNX runtime both Vector Search and Text Analysis run on: one block, shown the same on both pages, editing the
// same settings (the ONNX section of the embedding settings).
import { Check, DownloadSimple, Trash } from '@phosphor-icons/react';
import type { EmbeddingConfig, OnnxDevice } from '@novelwriter/core';
import { api, type EmbeddingStatus, type HardwareInfo } from '../../api.ts';
import { useEmbeddings } from '../../store/embeddings.ts';
import { t } from '../../i18n.ts';
import { Checkbox, ToggleRow } from '../../components/ui.tsx';
import { Group, Hardware, mb, Num, Pick, run, Text, toast } from './fields.tsx';

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

export function OnnxRuntimeSection({ status, hw, onRefreshHardware }: { status: EmbeddingStatus | null; hw: HardwareInfo | null; onRefreshHardware: () => void }) {
  const c = useEmbeddings((s) => s.config);
  if (!c) return null;
  const o = c.onnx;
  const rt = status?.runtime;
  const devices = ONNX_DEVICES.filter((d) => !hw || ((!d.os || d.os.includes(hw.os)) && (!d.arch || d.arch.includes(hw.arch))));
  const onnx = (p: Partial<EmbeddingConfig['onnx']>) => void useEmbeddings.getState().save({ onnx: p }).catch((e: Error) => toast(e.message));
  return (
    <div style={{ border: '1px solid var(--bg2)', padding: '4px 16px 16px', margin: '8px 0 16px' }}>
      <div className="heading" style={{ marginTop: 12 }}>{t('Runtime')}</div>
      <div className="desc" style={{ marginBottom: 8 }}>{t('Shared by Vector Search and Text Analysis: a change here applies to both.')}</div>
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

      <Group title="This Computer">
        <Hardware hw={hw} onRefresh={onRefreshHardware} />
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
    </div>
  );
}
