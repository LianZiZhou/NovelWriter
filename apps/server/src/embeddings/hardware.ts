// What this machine can run embeddings on: CPU, GPUs and NPUs, and the libraries the GPU builds need.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { llamaVariants, type OnnxDevice } from '@novelwriter/core';

export type Vendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'qualcomm' | 'other';

export interface Device {
  vendor: Vendor;
  name: string;
  /** Video memory in MB, when reported. */
  memoryMB?: number;
  driver?: string;
}

export interface HardwareInfo {
  os: NodeJS.Platform;
  arch: string;
  cpu: string;
  cores: number;
  memoryGB: number;
  gpus: Device[];
  npus: Device[];
  /** CUDA 12 runtime and cuDNN 9 found (what ONNX Runtime's CUDA provider needs). */
  cuda: { driver: boolean; runtime12: boolean; cudnn9: boolean };
  vulkan: boolean;
  /** Suggested settings for this machine. */
  suggest: { onnxDevice: OnnxDevice; llamaVariant: string };
}

function run(cmd: string, args: string[], timeout = 6000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function vendorOf(text: string): Vendor {
  const t = text.toLowerCase();
  if (/nvidia|geforce|quadro|tesla|rtx/.test(t) || t.includes('0x10de')) return 'nvidia';
  if (/amd|radeon|ati |advanced micro|ryzen ai|xdna|ipu/.test(t) || t.includes('0x1002') || t.includes('0x1022')) return 'amd';
  if (/intel|arc|iris|uhd|ai boost/.test(t) || t.includes('0x8086')) return 'intel';
  if (/apple/.test(t)) return 'apple';
  if (/qualcomm|adreno|hexagon|snapdragon/.test(t)) return 'qualcomm';
  return 'other';
}

async function windows(info: HardwareInfo) {
  const ps = (script: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 12000);
  const json = <T>(s: string): T[] => {
    try {
      const v = JSON.parse(s || '[]') as T | T[];
      return Array.isArray(v) ? v : [v];
    } catch {
      return [];
    }
  };
  const [gpus, npus] = await Promise.all([
    ps('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress'),
    ps(
      "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'NPU|AI Boost|Neural|Hexagon|IPU|Ryzen AI|Compute Accelerator' } | Select-Object Name,Manufacturer | ConvertTo-Json -Compress",
    ),
  ]);
  for (const g of json<{ Name?: string; AdapterRAM?: number; DriverVersion?: string }>(gpus)) {
    if (!g.Name || /basic display|remote display|virtual/i.test(g.Name)) continue;
    info.gpus.push({ vendor: vendorOf(g.Name), name: g.Name, memoryMB: g.AdapterRAM ? Math.round(g.AdapterRAM / 1048576) : undefined, driver: g.DriverVersion });
  }
  for (const n of json<{ Name?: string; Manufacturer?: string }>(npus)) {
    if (n.Name) info.npus.push({ vendor: vendorOf(`${n.Name} ${n.Manufacturer ?? ''}`), name: n.Name });
  }
  const sys = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  info.cuda.driver = existsSync(join(sys, 'nvcuda.dll'));
  info.vulkan = existsSync(join(sys, 'vulkan-1.dll'));
}

async function linux(info: HardwareInfo) {
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']);
  for (const line of smi.split('\n').filter(Boolean)) {
    const [name, mem, driver] = line.split(',').map((x) => x.trim());
    info.gpus.push({ vendor: 'nvidia', name, memoryMB: Number(mem) || undefined, driver });
  }
  info.cuda.driver = Boolean(smi);
  // Other GPUs from the DRM devices; names from lspci when it is there.
  const lspci = await run('lspci', ['-mm']);
  const named = lspci
    .split('\n')
    .filter((l) => /VGA|3D|Display/.test(l))
    .map((l) => l.replace(/"/g, ''));
  try {
    for (const card of readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d))) {
      const dev = join('/sys/class/drm', card, 'device');
      const vendorId = readFileSync(join(dev, 'vendor'), 'utf8').trim();
      const vendor = vendorOf(vendorId);
      if (vendor === 'nvidia' && info.gpus.some((g) => g.vendor === 'nvidia')) continue;
      const slot = basename(readlinkSync(dev)).replace(/^0000:/, '');
      const name = named.find((l) => l.startsWith(slot))?.split(' ').slice(1).join(' ') ?? `${vendor.toUpperCase()} GPU (${slot})`;
      if (!info.gpus.some((g) => g.name === name)) info.gpus.push({ vendor, name });
    }
  } catch {
    /* no DRM */
  }
  // NPUs: Intel (intel_vpu), AMD (amdxdna), Qualcomm (qaic) use the accel subsystem.
  try {
    for (const a of readdirSync('/sys/class/accel')) {
      let driver = '';
      try {
        driver = basename(readlinkSync(join('/sys/class/accel', a, 'device', 'driver')));
      } catch {
        /* unknown */
      }
      const vendor: Vendor = driver.includes('intel') ? 'intel' : driver.includes('amd') ? 'amd' : driver.includes('qaic') ? 'qualcomm' : 'other';
      const name = vendor === 'intel' ? 'Intel NPU' : vendor === 'amd' ? 'AMD Ryzen AI NPU' : vendor === 'qualcomm' ? 'Qualcomm AI accelerator' : `NPU (${driver || a})`;
      info.npus.push({ vendor, name, driver });
    }
  } catch {
    /* no accel devices */
  }
  const ld = await run('ldconfig', ['-p']);
  info.cuda.runtime12 = /libcudart\.so\.12|libcublasLt\.so\.12/.test(ld);
  info.cuda.cudnn9 = /libcudnn\.so\.9/.test(ld);
  info.vulkan = /libvulkan\.so/.test(ld);
}

async function mac(info: HardwareInfo) {
  const out = await run('system_profiler', ['SPDisplaysDataType', '-json']);
  try {
    const data = JSON.parse(out) as { SPDisplaysDataType?: { sppci_model?: string; _name?: string; sppci_cores?: string }[] };
    for (const g of data.SPDisplaysDataType ?? []) {
      const name = g.sppci_model ?? g._name ?? 'GPU';
      info.gpus.push({ vendor: vendorOf(name), name: g.sppci_cores ? `${name} (${g.sppci_cores} cores)` : name });
    }
  } catch {
    /* ignore */
  }
  if (process.arch === 'arm64') info.npus.push({ vendor: 'apple', name: 'Apple Neural Engine' });
}

let cached: Promise<HardwareInfo> | null = null;

export function detectHardware(refresh = false): Promise<HardwareInfo> {
  if (!cached || refresh) cached = detect();
  return cached;
}

async function detect(): Promise<HardwareInfo> {
  const c = cpus();
  const info: HardwareInfo = {
    os: process.platform,
    arch: process.arch,
    cpu: c[0]?.model?.trim() ?? 'CPU',
    cores: c.length,
    memoryGB: Math.round(totalmem() / 1073741824),
    gpus: [],
    npus: [],
    cuda: { driver: false, runtime12: false, cudnn9: false },
    vulkan: false,
    suggest: { onnxDevice: 'cpu', llamaVariant: '' },
  };
  if (process.platform === 'win32') await windows(info);
  else if (process.platform === 'linux') await linux(info);
  else if (process.platform === 'darwin') await mac(info);
  info.suggest = suggest(info);
  return info;
}

function suggest(info: HardwareInfo): HardwareInfo['suggest'] {
  const has = (v: Vendor) => info.gpus.some((g) => g.vendor === v);
  let onnxDevice: OnnxDevice = 'cpu';
  if (info.os === 'darwin') onnxDevice = info.arch === 'arm64' ? 'coreml' : 'cpu';
  else if (info.os === 'win32' && info.gpus.length) onnxDevice = 'dml';
  else if (info.os === 'linux' && info.arch === 'x64' && has('nvidia') && info.cuda.runtime12 && info.cuda.cudnn9) onnxDevice = 'cuda';
  const variants = llamaVariants(info.os, info.arch);
  const pick = (backend: string) => variants.find((v) => v.backend === backend)?.id;
  let llamaVariant = pick('cpu') ?? variants[0]?.id ?? '';
  if (info.os === 'darwin') llamaVariant = pick('metal') ?? llamaVariant;
  else if (has('nvidia')) llamaVariant = pick('cuda') ?? pick('vulkan') ?? llamaVariant;
  else if (has('amd') || has('intel')) llamaVariant = (info.vulkan || info.os === 'win32' ? pick('vulkan') : undefined) ?? llamaVariant;
  else if (has('qualcomm')) llamaVariant = pick('opencl') ?? pick('hexagon') ?? llamaVariant;
  return { onnxDevice, llamaVariant };
}
