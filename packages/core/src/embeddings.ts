/**
 * Text embeddings for recalling earlier passages by meaning: the models NovelWriter knows how to run, the
 * settings of the three engines (built-in ONNX Runtime, a managed llama.cpp server, an OpenAI-compatible
 * endpoint) and the text each model expects around queries and passages.
 *
 * Nothing here downloads anything: models and runtimes are fetched only when the user asks for them.
 */

export type EmbeddingSource = 'onnx' | 'llamacpp' | 'endpoint';
export type EmbeddingPooling = 'cls' | 'mean' | 'last';
export type OnnxDtype = 'fp32' | 'fp16' | 'int8' | 'uint8' | 'quantized' | 'q4' | 'q4f16' | 'bnb4';
/**
 * ONNX Runtime execution providers. `cpu`, `webgpu`, `dml` (Windows), `cuda`/`tensorrt` (Linux x64, provider
 * libraries installed on request) and `coreml` (macOS, including the Apple Neural Engine) work with the stock
 * runtime; `qnn` (Qualcomm NPU) needs a runtime built with it; `custom` takes the provider list as JSON.
 */
export type OnnxDevice = 'auto' | 'cpu' | 'webgpu' | 'dml' | 'cuda' | 'tensorrt' | 'coreml' | 'qnn' | 'custom';

export interface GgufFile {
  quant: string;
  file: string;
  /** Size in MB. */
  mb: number;
}

export interface EmbeddingModelInfo {
  /** Stable id used in settings. */
  id: string;
  name: string;
  /** Languages it is good at: `zh`, `en` or `multi`. */
  lang: 'zh' | 'en' | 'multi';
  dims: number;
  /** Matryoshka models can be cut to these sizes. */
  mrl?: number[];
  maxTokens: number;
  pooling: EmbeddingPooling;
  queryPrefix?: string;
  docPrefix?: string;
  /** Hugging Face repo with an `onnx/` folder (transformers.js layout), and the file sizes in MB by dtype. */
  onnx?: { repo: string; sizes: Partial<Record<OnnxDtype, number>>; recommended: OnnxDtype; externalData?: boolean };
  /** Hugging Face repo with GGUF files for llama.cpp. */
  gguf?: { repo: string; files: GgufFile[]; recommended: string };
  note?: string;
}

const g = (quant: string, file: string, mb: number): GgufFile => ({ quant, file, mb });
const QWEN3_QUERY = 'Instruct: Given the latest passage of a story, retrieve earlier passages that it refers to or continues\nQuery:';

/** Models checked to load with the built-in engines (sizes from the Hugging Face file listings). */
export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  {
    id: 'bge-small-zh-v1.5',
    name: 'BGE Small zh v1.5',
    lang: 'zh',
    dims: 512,
    maxTokens: 512,
    pooling: 'cls',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    onnx: { repo: 'Xenova/bge-small-zh-v1.5', sizes: { fp32: 95, fp16: 47, int8: 24, uint8: 24, quantized: 24, q4: 52, q4f16: 29, bnb4: 52 }, recommended: 'int8' },
    gguf: { repo: 'CompendiumLabs/bge-small-zh-v1.5-gguf', files: [g('Q4_K_M', 'bge-small-zh-v1.5-q4_k_m.gguf', 15), g('Q8_0', 'bge-small-zh-v1.5-q8_0.gguf', 26), g('F16', 'bge-small-zh-v1.5-f16.gguf', 48), g('F32', 'bge-small-zh-v1.5-f32.gguf', 95)], recommended: 'Q8_0' },
    note: 'Smallest and fastest model for Chinese.',
  },
  {
    id: 'bge-base-zh-v1.5',
    name: 'BGE Base zh v1.5',
    lang: 'zh',
    dims: 768,
    maxTokens: 512,
    pooling: 'cls',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    onnx: { repo: 'Xenova/bge-base-zh-v1.5', sizes: { fp32: 407, fp16: 204, int8: 102, uint8: 102, quantized: 103, q4: 120, q4f16: 82, bnb4: 115 }, recommended: 'int8' },
    gguf: { repo: 'CompendiumLabs/bge-base-zh-v1.5-gguf', files: [g('Q4_K_M', 'bge-base-zh-v1.5-q4_k_m.gguf', 64), g('Q8_0', 'bge-base-zh-v1.5-q8_0.gguf', 110), g('F16', 'bge-base-zh-v1.5-f16.gguf', 204), g('F32', 'bge-base-zh-v1.5-f32.gguf', 407)], recommended: 'Q8_0' },
  },
  {
    id: 'bge-large-zh-v1.5',
    name: 'BGE Large zh v1.5',
    lang: 'zh',
    dims: 1024,
    maxTokens: 512,
    pooling: 'cls',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    onnx: { repo: 'Xenova/bge-large-zh-v1.5', sizes: { fp32: 1298, fp16: 650, int8: 326, uint8: 326, quantized: 327, q4: 279, q4f16: 215, bnb4: 260 }, recommended: 'int8' },
    gguf: { repo: 'CompendiumLabs/bge-large-zh-v1.5-gguf', files: [g('Q4_K_M', 'bge-large-zh-v1.5-q4_k_m.gguf', 202), g('Q8_0', 'bge-large-zh-v1.5-q8_0.gguf', 348), g('F16', 'bge-large-zh-v1.5-f16.gguf', 650), g('F32', 'bge-large-zh-v1.5-f32.gguf', 1298)], recommended: 'Q8_0' },
  },
  {
    id: 'bge-m3',
    name: 'BGE-M3',
    lang: 'multi',
    dims: 1024,
    maxTokens: 8192,
    pooling: 'cls',
    onnx: { repo: 'Xenova/bge-m3', sizes: { fp16: 1134, int8: 568, uint8: 568, quantized: 570, q4f16: 700 }, recommended: 'int8' },
    gguf: {
      repo: 'gpustack/bge-m3-GGUF',
      files: [g('Q4_K_M', 'bge-m3-Q4_K_M.gguf', 438), g('Q5_K_M', 'bge-m3-Q5_K_M.gguf', 468), g('Q6_K', 'bge-m3-Q6_K.gguf', 499), g('Q8_0', 'bge-m3-Q8_0.gguf', 635), g('F16', 'bge-m3-FP16.gguf', 1158)],
      recommended: 'Q8_0',
    },
    note: 'Strong for Chinese, English and 100+ languages; long passages.',
  },
  {
    id: 'qwen3-embedding-0.6b',
    name: 'Qwen3 Embedding 0.6B',
    lang: 'multi',
    dims: 1024,
    mrl: [32, 64, 128, 256, 512, 768, 1024],
    maxTokens: 32768,
    pooling: 'last',
    queryPrefix: QWEN3_QUERY,
    onnx: { repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX', sizes: { int8: 614, uint8: 614, quantized: 614, q4: 914, q4f16: 567, bnb4: 887 }, recommended: 'q4f16' },
    gguf: { repo: 'Qwen/Qwen3-Embedding-0.6B-GGUF', files: [g('Q8_0', 'Qwen3-Embedding-0.6B-Q8_0.gguf', 639), g('F16', 'Qwen3-Embedding-0.6B-f16.gguf', 1198)], recommended: 'Q8_0' },
    note: 'Best quality per size for Chinese; a GPU helps.',
  },
  {
    id: 'qwen3-embedding-4b',
    name: 'Qwen3 Embedding 4B',
    lang: 'multi',
    dims: 2560,
    mrl: [256, 512, 768, 1024, 2048, 2560],
    maxTokens: 32768,
    pooling: 'last',
    queryPrefix: QWEN3_QUERY,
    gguf: {
      repo: 'Qwen/Qwen3-Embedding-4B-GGUF',
      files: [g('Q4_K_M', 'Qwen3-Embedding-4B-Q4_K_M.gguf', 2497), g('Q5_K_M', 'Qwen3-Embedding-4B-Q5_K_M.gguf', 2889), g('Q6_K', 'Qwen3-Embedding-4B-Q6_K.gguf', 3306), g('Q8_0', 'Qwen3-Embedding-4B-Q8_0.gguf', 4280), g('F16', 'Qwen3-Embedding-4B-f16.gguf', 8050)],
      recommended: 'Q4_K_M',
    },
    note: 'Needs a GPU.',
  },
  {
    id: 'qwen3-embedding-8b',
    name: 'Qwen3 Embedding 8B',
    lang: 'multi',
    dims: 4096,
    mrl: [256, 512, 1024, 2048, 4096],
    maxTokens: 32768,
    pooling: 'last',
    queryPrefix: QWEN3_QUERY,
    gguf: {
      repo: 'Qwen/Qwen3-Embedding-8B-GGUF',
      files: [g('Q4_K_M', 'Qwen3-Embedding-8B-Q4_K_M.gguf', 4677), g('Q5_K_M', 'Qwen3-Embedding-8B-Q5_K_M.gguf', 5422), g('Q6_K', 'Qwen3-Embedding-8B-Q6_K.gguf', 6214), g('Q8_0', 'Qwen3-Embedding-8B-Q8_0.gguf', 8047), g('F16', 'Qwen3-Embedding-8B-f16.gguf', 15141)],
      recommended: 'Q4_K_M',
    },
    note: 'Needs a GPU with 8 GB or more.',
  },
  {
    id: 'embeddinggemma-300m',
    name: 'EmbeddingGemma 300M',
    lang: 'multi',
    dims: 768,
    mrl: [128, 256, 512, 768],
    maxTokens: 2048,
    pooling: 'mean',
    queryPrefix: 'task: search result | query: ',
    docPrefix: 'title: none | text: ',
    onnx: { repo: 'onnx-community/embeddinggemma-300m-ONNX', sizes: { fp16: 617, quantized: 309, q4: 197, q4f16: 175 }, recommended: 'q4', externalData: true },
    gguf: { repo: 'ggml-org/embeddinggemma-300M-GGUF', files: [g('Q8_0', 'embeddinggemma-300M-Q8_0.gguf', 334)], recommended: 'Q8_0' },
    note: 'Also runs on AMD Ryzen AI NPUs through FastFlowLM.',
  },
  {
    id: 'multilingual-e5-small',
    name: 'Multilingual E5 Small',
    lang: 'multi',
    dims: 384,
    maxTokens: 512,
    pooling: 'mean',
    queryPrefix: 'query: ',
    docPrefix: 'passage: ',
    onnx: { repo: 'Xenova/multilingual-e5-small', sizes: { fp32: 470, fp16: 235, int8: 118, uint8: 118, quantized: 118, q4f16: 205 }, recommended: 'int8' },
  },
  {
    id: 'multilingual-e5-base',
    name: 'Multilingual E5 Base',
    lang: 'multi',
    dims: 768,
    maxTokens: 512,
    pooling: 'mean',
    queryPrefix: 'query: ',
    docPrefix: 'passage: ',
    onnx: { repo: 'Xenova/multilingual-e5-base', sizes: { fp16: 555, int8: 278, uint8: 278, quantized: 279, q4f16: 433 }, recommended: 'int8' },
  },
  {
    id: 'multilingual-e5-large',
    name: 'Multilingual E5 Large',
    lang: 'multi',
    dims: 1024,
    maxTokens: 512,
    pooling: 'mean',
    queryPrefix: 'query: ',
    docPrefix: 'passage: ',
    onnx: { repo: 'Xenova/multilingual-e5-large', sizes: { fp16: 1118, quantized: 562 }, recommended: 'quantized' },
  },
  {
    id: 'multilingual-e5-large-instruct',
    name: 'Multilingual E5 Large Instruct',
    lang: 'multi',
    dims: 1024,
    maxTokens: 512,
    pooling: 'mean',
    queryPrefix: 'Instruct: Given the latest passage of a story, retrieve earlier passages that it refers to\nQuery: ',
    gguf: {
      repo: 'Ralriki/multilingual-e5-large-instruct-GGUF',
      files: [g('Q4_K_M', 'multilingual-e5-large-instruct-q4_k_m.gguf', 406), g('Q6_K', 'multilingual-e5-large-instruct-q6_k.gguf', 468), g('Q8_0', 'multilingual-e5-large-instruct-q8_0.gguf', 603), g('F16', 'multilingual-e5-large-instruct-F16.gguf', 1126)],
      recommended: 'Q8_0',
    },
  },
  {
    id: 'gte-multilingual-base',
    name: 'GTE Multilingual Base',
    lang: 'multi',
    dims: 768,
    mrl: [128, 256, 512, 768],
    maxTokens: 8192,
    pooling: 'cls',
    onnx: { repo: 'onnx-community/gte-multilingual-base', sizes: { fp16: 628, int8: 340, uint8: 340, quantized: 340, q4f16: 465 }, recommended: 'int8' },
  },
  {
    id: 'snowflake-arctic-embed-m-v2.0',
    name: 'Snowflake Arctic Embed M v2.0',
    lang: 'multi',
    dims: 768,
    mrl: [256, 768],
    maxTokens: 8192,
    pooling: 'cls',
    queryPrefix: 'query: ',
    onnx: { repo: 'Snowflake/snowflake-arctic-embed-m-v2.0', sizes: { fp16: 613, int8: 311, uint8: 311, quantized: 311, q4f16: 450 }, recommended: 'int8' },
  },
  {
    id: 'snowflake-arctic-embed-l-v2.0',
    name: 'Snowflake Arctic Embed L v2.0',
    lang: 'multi',
    dims: 1024,
    mrl: [256, 1024],
    maxTokens: 8192,
    pooling: 'cls',
    queryPrefix: 'query: ',
    onnx: { repo: 'Snowflake/snowflake-arctic-embed-l-v2.0', sizes: { fp16: 1134, int8: 570, uint8: 570, quantized: 570, q4f16: 700 }, recommended: 'int8' },
    gguf: {
      repo: 'Casual-Autopsy/snowflake-arctic-embed-l-v2.0-gguf',
      files: [g('Q4_K_M', 'snowflake-arctic-embed-l-v2.0-q4_k_m.gguf', 438), g('F16', 'snowflake-arctic-embed-l-v2.0-f16.gguf', 1158)],
      recommended: 'Q4_K_M',
    },
  },
  {
    id: 'jina-embeddings-v2-base-zh',
    name: 'Jina Embeddings v2 Base zh',
    lang: 'zh',
    dims: 768,
    maxTokens: 8192,
    pooling: 'mean',
    onnx: { repo: 'jinaai/jina-embeddings-v2-base-zh', sizes: { fp32: 641, fp16: 321, quantized: 162 }, recommended: 'quantized' },
    note: 'Chinese and English; long passages.',
  },
  {
    id: 'paraphrase-multilingual-minilm-l12-v2',
    name: 'Paraphrase Multilingual MiniLM L12 v2',
    lang: 'multi',
    dims: 384,
    maxTokens: 128,
    pooling: 'mean',
    onnx: { repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', sizes: { fp32: 470, fp16: 235, int8: 118, uint8: 118, quantized: 118 }, recommended: 'int8' },
  },
  {
    id: 'nomic-embed-text-v1.5',
    name: 'Nomic Embed Text v1.5',
    lang: 'en',
    dims: 768,
    mrl: [64, 128, 256, 512, 768],
    maxTokens: 8192,
    pooling: 'mean',
    queryPrefix: 'search_query: ',
    docPrefix: 'search_document: ',
    onnx: { repo: 'nomic-ai/nomic-embed-text-v1.5', sizes: { fp32: 547, fp16: 274, int8: 137, uint8: 137, quantized: 137, q4f16: 111 }, recommended: 'int8' },
    gguf: {
      repo: 'nomic-ai/nomic-embed-text-v1.5-GGUF',
      files: [g('Q4_K_M', 'nomic-embed-text-v1.5.Q4_K_M.gguf', 84), g('Q5_K_M', 'nomic-embed-text-v1.5.Q5_K_M.gguf', 100), g('Q6_K', 'nomic-embed-text-v1.5.Q6_K.gguf', 113), g('Q8_0', 'nomic-embed-text-v1.5.Q8_0.gguf', 146), g('F16', 'nomic-embed-text-v1.5.f16.gguf', 274)],
      recommended: 'Q8_0',
    },
  },
  {
    id: 'nomic-embed-text-v2-moe',
    name: 'Nomic Embed Text v2 MoE',
    lang: 'multi',
    dims: 768,
    mrl: [256, 768],
    maxTokens: 512,
    pooling: 'mean',
    queryPrefix: 'search_query: ',
    docPrefix: 'search_document: ',
    gguf: {
      repo: 'nomic-ai/nomic-embed-text-v2-moe-GGUF',
      files: [g('Q4_K_M', 'nomic-embed-text-v2-moe.Q4_K_M.gguf', 344), g('Q6_K', 'nomic-embed-text-v2-moe.Q6_K.gguf', 397), g('Q8_0', 'nomic-embed-text-v2-moe.Q8_0.gguf', 512)],
      recommended: 'Q8_0',
    },
  },
  {
    id: 'mxbai-embed-large-v1',
    name: 'mxbai Embed Large v1',
    lang: 'en',
    dims: 1024,
    mrl: [256, 512, 1024],
    maxTokens: 512,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    onnx: { repo: 'mixedbread-ai/mxbai-embed-large-v1', sizes: { fp32: 1337, fp16: 669, quantized: 337 }, recommended: 'quantized' },
    gguf: {
      repo: 'ChristianAzinn/mxbai-embed-large-v1-gguf',
      files: [g('Q4_K_M', 'mxbai-embed-large-v1.Q4_K_M.gguf', 216), g('Q8_0', 'mxbai-embed-large-v1.Q8_0.gguf', 358), g('F16', 'mxbai-embed-large-v1_fp16.gguf', 670)],
      recommended: 'Q8_0',
    },
  },
  {
    id: 'gte-modernbert-base',
    name: 'GTE ModernBERT Base',
    lang: 'en',
    dims: 768,
    maxTokens: 8192,
    pooling: 'cls',
    onnx: { repo: 'Alibaba-NLP/gte-modernbert-base', sizes: { fp32: 596, fp16: 298, int8: 150, uint8: 150, quantized: 150, q4f16: 140 }, recommended: 'int8' },
  },
  {
    id: 'bge-small-en-v1.5',
    name: 'BGE Small en v1.5',
    lang: 'en',
    dims: 384,
    maxTokens: 512,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    onnx: { repo: 'Xenova/bge-small-en-v1.5', sizes: { fp32: 133, fp16: 67, int8: 34, uint8: 34, quantized: 34, q4f16: 36 }, recommended: 'int8' },
  },
  {
    id: 'bge-base-en-v1.5',
    name: 'BGE Base en v1.5',
    lang: 'en',
    dims: 768,
    maxTokens: 512,
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    onnx: { repo: 'Xenova/bge-base-en-v1.5', sizes: { fp32: 436, fp16: 218, int8: 110, uint8: 110, quantized: 110, q4f16: 96 }, recommended: 'int8' },
  },
  {
    id: 'all-minilm-l6-v2',
    name: 'all-MiniLM-L6-v2',
    lang: 'en',
    dims: 384,
    maxTokens: 256,
    pooling: 'mean',
    onnx: { repo: 'Xenova/all-MiniLM-L6-v2', sizes: { fp32: 90, fp16: 45, int8: 23, uint8: 23, quantized: 23, q4f16: 30 }, recommended: 'int8' },
  },
];

export function embeddingModel(id: string): EmbeddingModelInfo | undefined {
  return EMBEDDING_MODELS.find((m) => m.id === id || m.onnx?.repo === id || m.gguf?.repo === id);
}

// ------------------------------------------------------------- llama.cpp builds

export type LlamaBackend = 'cpu' | 'cuda' | 'vulkan' | 'rocm' | 'sycl' | 'openvino' | 'metal' | 'opencl' | 'hexagon';

export interface LlamaVariant {
  id: string;
  os: 'win32' | 'linux' | 'darwin';
  arch: 'x64' | 'arm64';
  backend: LlamaBackend;
  /** Matches the release asset name after `llama-<tag>-bin-`. */
  pattern: string;
  label: string;
  /** Also download the CUDA runtime archive llama.cpp publishes for this build. */
  cudart?: boolean;
}

/** llama.cpp's prebuilt release archives. Version numbers in the names change, so they are matched by pattern. */
export const LLAMA_VARIANTS: LlamaVariant[] = [
  { id: 'win-cpu-x64', os: 'win32', arch: 'x64', backend: 'cpu', pattern: 'win-cpu-x64\\.zip', label: 'CPU' },
  { id: 'win-cuda12-x64', os: 'win32', arch: 'x64', backend: 'cuda', pattern: 'win-cuda-12[\\d.]*-x64\\.zip', label: 'NVIDIA CUDA 12', cudart: true },
  { id: 'win-cuda13-x64', os: 'win32', arch: 'x64', backend: 'cuda', pattern: 'win-cuda-13[\\d.]*-x64\\.zip', label: 'NVIDIA CUDA 13', cudart: true },
  { id: 'win-vulkan-x64', os: 'win32', arch: 'x64', backend: 'vulkan', pattern: 'win-vulkan-x64\\.zip', label: 'Vulkan (NVIDIA / AMD / Intel GPUs)' },
  { id: 'win-rocm-x64', os: 'win32', arch: 'x64', backend: 'rocm', pattern: 'win-(?:rocm|hip)[\\w.-]*-x64\\.zip', label: 'AMD ROCm / HIP' },
  { id: 'win-sycl-x64', os: 'win32', arch: 'x64', backend: 'sycl', pattern: 'win-sycl-x64\\.zip', label: 'Intel SYCL (Arc / Iris Xe)' },
  { id: 'win-openvino-x64', os: 'win32', arch: 'x64', backend: 'openvino', pattern: 'win-openvino[\\d.-]*-x64\\.zip', label: 'Intel OpenVINO (CPU / GPU / NPU)' },
  { id: 'win-cpu-arm64', os: 'win32', arch: 'arm64', backend: 'cpu', pattern: 'win-cpu-arm64\\.zip', label: 'CPU' },
  { id: 'win-vulkan-arm64', os: 'win32', arch: 'arm64', backend: 'vulkan', pattern: 'win-vulkan-arm64\\.zip', label: 'Vulkan' },
  { id: 'win-cuda13-arm64', os: 'win32', arch: 'arm64', backend: 'cuda', pattern: 'win-cuda-13[\\d.]*-arm64\\.zip', label: 'NVIDIA CUDA 13', cudart: true },
  { id: 'win-opencl-adreno-arm64', os: 'win32', arch: 'arm64', backend: 'opencl', pattern: 'win-opencl-adreno-arm64\\.zip', label: 'Qualcomm Adreno GPU (OpenCL)' },
  { id: 'linux-cpu-x64', os: 'linux', arch: 'x64', backend: 'cpu', pattern: 'ubuntu-x64\\.tar\\.gz', label: 'CPU' },
  { id: 'linux-cuda12-x64', os: 'linux', arch: 'x64', backend: 'cuda', pattern: 'ubuntu-cuda-12[\\d.]*-x64\\.tar\\.gz', label: 'NVIDIA CUDA 12', cudart: true },
  { id: 'linux-cuda13-x64', os: 'linux', arch: 'x64', backend: 'cuda', pattern: 'ubuntu-cuda-13[\\d.]*-x64\\.tar\\.gz', label: 'NVIDIA CUDA 13', cudart: true },
  { id: 'linux-vulkan-x64', os: 'linux', arch: 'x64', backend: 'vulkan', pattern: 'ubuntu-vulkan-x64\\.tar\\.gz', label: 'Vulkan (NVIDIA / AMD / Intel GPUs)' },
  { id: 'linux-rocm-x64', os: 'linux', arch: 'x64', backend: 'rocm', pattern: 'ubuntu-rocm[\\d.-]*-x64\\.tar\\.gz', label: 'AMD ROCm' },
  { id: 'linux-sycl-fp16-x64', os: 'linux', arch: 'x64', backend: 'sycl', pattern: 'ubuntu-sycl-fp16-x64\\.tar\\.gz', label: 'Intel SYCL FP16' },
  { id: 'linux-sycl-fp32-x64', os: 'linux', arch: 'x64', backend: 'sycl', pattern: 'ubuntu-sycl-fp32-x64\\.tar\\.gz', label: 'Intel SYCL FP32' },
  { id: 'linux-openvino-x64', os: 'linux', arch: 'x64', backend: 'openvino', pattern: 'ubuntu-openvino[\\d.-]*-x64\\.tar\\.gz', label: 'Intel OpenVINO (CPU / GPU / NPU)' },
  { id: 'linux-cpu-arm64', os: 'linux', arch: 'arm64', backend: 'cpu', pattern: 'ubuntu-arm64\\.tar\\.gz', label: 'CPU' },
  { id: 'linux-vulkan-arm64', os: 'linux', arch: 'arm64', backend: 'vulkan', pattern: 'ubuntu-vulkan-arm64\\.tar\\.gz', label: 'Vulkan' },
  { id: 'linux-cuda13-arm64', os: 'linux', arch: 'arm64', backend: 'cuda', pattern: 'ubuntu-cuda-13[\\d.]*-arm64\\.tar\\.gz', label: 'NVIDIA CUDA 13 (Jetson / GH200)' },
  { id: 'linux-snapdragon-arm64', os: 'linux', arch: 'arm64', backend: 'hexagon', pattern: 'linux-arm64-snapdragon\\.tar\\.gz', label: 'Qualcomm Snapdragon (Hexagon NPU / Adreno)' },
  { id: 'mac-metal-arm64', os: 'darwin', arch: 'arm64', backend: 'metal', pattern: 'macos-arm64\\.tar\\.gz', label: 'Apple Silicon (Metal)' },
  { id: 'mac-x64', os: 'darwin', arch: 'x64', backend: 'cpu', pattern: 'macos-x64\\.tar\\.gz', label: 'Intel Mac' },
];

export function llamaVariants(os: string, arch: string): LlamaVariant[] {
  return LLAMA_VARIANTS.filter((v) => v.os === os && v.arch === arch);
}

// ------------------------------------------------------------- endpoints

export interface EndpointPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** Runs on this machine (no key needed). */
  local?: boolean;
  /** Path of the embeddings route under the base URL. */
  path?: string;
  /** Hardware it brings, for the description. */
  note?: string;
}

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { id: 'custom', name: 'Custom', baseUrl: '', model: '' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-embedding-001' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-embed' },
  { id: 'jina', name: 'Jina AI', baseUrl: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3' },
  { id: 'voyage', name: 'Voyage AI', baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-3.5' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'BAAI/bge-base-en-v1.5' },
  { id: 'fireworks', name: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'nomic-ai/nomic-embed-text-v1.5' },
  { id: 'deepinfra', name: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', model: 'BAAI/bge-m3' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
  { id: 'dashscope', name: 'Alibaba DashScope 百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v4' },
  { id: 'zhipu', name: 'Zhipu 智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3' },
  { id: 'volcengine', name: 'Volcengine Ark 火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-embedding-text-240715' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'bge-m3', local: true, note: 'CPU, NVIDIA, AMD and Apple GPUs.' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'text-embedding-nomic-embed-text-v1.5', local: true, note: 'CPU, CUDA, Vulkan, ROCm, Metal and MLX.' },
  { id: 'llamacpp', name: 'llama.cpp server', baseUrl: 'http://127.0.0.1:8080/v1', model: 'default', local: true, note: 'Start it with --embedding.' },
  { id: 'vllm', name: 'vLLM', baseUrl: 'http://127.0.0.1:8000/v1', model: 'BAAI/bge-m3', local: true, note: 'NVIDIA, AMD, Intel GPUs and TPUs.' },
  { id: 'tei', name: 'Text Embeddings Inference', baseUrl: 'http://127.0.0.1:8080/v1', model: 'tei', local: true, note: 'Hugging Face TEI: CPU, NVIDIA GPUs, Intel Gaudi.' },
  { id: 'infinity', name: 'Infinity', baseUrl: 'http://127.0.0.1:7997', model: 'BAAI/bge-m3', local: true },
  { id: 'localai', name: 'LocalAI', baseUrl: 'http://127.0.0.1:8080/v1', model: 'bge-m3', local: true },
  { id: 'xinference', name: 'Xinference', baseUrl: 'http://127.0.0.1:9997/v1', model: 'bge-m3', local: true },
  { id: 'ovms', name: 'OpenVINO Model Server', baseUrl: 'http://127.0.0.1:8000/v3', model: 'BAAI/bge-large-zh-v1.5', local: true, note: 'Intel CPU, GPU and NPU.' },
  { id: 'fastflowlm', name: 'FastFlowLM', baseUrl: 'http://127.0.0.1:52625/v1', model: 'embed-gemma:300m', local: true, note: 'AMD Ryzen AI NPU (XDNA 2). Start with: flm serve <model> --embed 1' },
  { id: 'lemonade', name: 'Lemonade Server', baseUrl: 'http://127.0.0.1:8000/api/v1', model: 'nomic-embed-text-v1-GGUF', local: true, note: 'AMD Ryzen AI: GPU through llama.cpp, NPU through FastFlowLM.' },
  { id: 'nexa', name: 'Nexa SDK', baseUrl: 'http://127.0.0.1:18181/v1', model: 'NexaAI/embeddinggemma-300m-npu', local: true, note: 'Qualcomm, Intel and AMD NPUs where Nexa supports them.' },
  { id: 'foundry', name: 'Foundry Local', baseUrl: 'http://127.0.0.1:5273/v1', model: '', local: true, note: 'Microsoft Foundry Local: CPU, GPU and NPU through ONNX Runtime.' },
];

// ------------------------------------------------------------- settings

export interface OnnxEmbeddingConfig {
  /** Catalog id, or a Hugging Face repo id in the transformers.js layout. */
  model: string;
  dtype: OnnxDtype | 'auto';
  device: OnnxDevice;
  /** GPU index for DirectML, CUDA and TensorRT. */
  deviceId: number;
  /** CoreML: which units may run the model. */
  coremlUnits: 'all' | 'ane' | 'cpu-gpu' | 'cpu';
  coremlMlProgram: boolean;
  coremlStaticShapes: boolean;
  coremlSubgraphs: boolean;
  qnnBackend: 'htp' | 'gpu' | 'cpu';
  qnnBackendPath: string;
  qnnFp16: boolean;
  webgpuLayout: 'NCHW' | 'NHWC';
  /** `device: custom`: the `executionProviders` array as JSON. */
  customProviders: string;
  /** A directory holding an onnxruntime-node package built with more execution providers (QNN, …). */
  customRuntime: string;
  /** Add the CPU provider after the chosen one, for operators it can't run. */
  cpuFallback: boolean;
  intraOpThreads: number;
  interOpThreads: number;
  graphOptimization: 'disabled' | 'basic' | 'extended' | 'all';
  executionMode: 'sequential' | 'parallel';
  memArena: boolean;
  memPattern: boolean;
  logLevel: 0 | 1 | 2 | 3 | 4;
}

export interface LlamaEmbeddingConfig {
  binary: 'managed' | 'custom';
  customBinary: string;
  /** Build to download; `auto` picks one for this machine. */
  variant: string;
  /** Release tag (`b1234`), or `latest`. */
  release: string;
  /** Prefix for GitHub downloads, for mirrors such as https://ghfast.top/. */
  mirror: string;
  /** `<catalog id>:<quant>` or `path:<file>`. */
  model: string;
  gpuLayers: number;
  /** `--device`, e.g. CUDA0, Vulkan1, none; empty for the default. */
  device: string;
  splitMode: 'default' | 'none' | 'layer' | 'row';
  mainGpu: number;
  tensorSplit: string;
  threads: number;
  threadsBatch: number;
  ctxSize: number;
  batchSize: number;
  ubatchSize: number;
  parallel: number;
  pooling: 'auto' | 'none' | 'mean' | 'cls' | 'last';
  flashAttn: 'auto' | 'on' | 'off';
  mlock: boolean;
  mmap: boolean;
  port: number;
  extraArgs: string;
  /** `NAME=value` lines, e.g. CUDA_VISIBLE_DEVICES, GGML_VK_VISIBLE_DEVICES, ONEAPI_DEVICE_SELECTOR, GGML_OPENVINO_DEVICE=NPU. */
  env: string;
  /** Stop the server after this many idle minutes (0 = keep running). */
  idleMinutes: number;
}

export interface EndpointEmbeddingConfig {
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Requested output size (0 = the model's own). */
  dimensions: number;
  encodingFormat: 'float' | 'base64';
  /** Extra JSON merged into every request body, e.g. {"input_type": "document"}. */
  extraBody: string;
  /** Extra HTTP headers as JSON. */
  headers: string;
  concurrency: number;
  timeoutMs: number;
  /** Catalog model whose prefixes to use, if the endpoint serves one. */
  catalogModel: string;
}

export interface EmbeddingConfig {
  enabled: boolean;
  source: EmbeddingSource;
  /** Hugging Face host for model downloads (e.g. https://hf-mirror.com). */
  hfEndpoint: string;
  /** Where models are kept; empty = `models/` in the data folder. */
  modelsDir: string;
  /** npm registry the ONNX runtime is downloaded from (e.g. https://registry.npmmirror.com). */
  npmRegistry: string;
  /** NuGet package base for the CUDA provider libraries (Linux). */
  nugetFeed: string;
  /** Texts per request. */
  batchSize: number;
  /** Cut inputs to this many tokens (0 = the model's limit, at most 512 for passages). */
  maxTokens: number;
  /** Output size for Matryoshka models (0 = full). */
  dimensions: number;
  /** null = the model's own prefix. */
  queryPrefix: string | null;
  docPrefix: string | null;
  pooling: 'auto' | EmbeddingPooling;
  /** Recall: vector hits considered per generation. */
  topK: number;
  /** Recall: cosine similarity a passage needs. */
  minScore: number;
  /** Recall: weight of the vector ranking against keywords (BM25) when they are fused. */
  vectorWeight: number;
  /** Recall: characters of the latest text used as the query. */
  queryChars: number;
  /** Give up on the vector search (keywords only) after this long. */
  queryTimeoutMs: number;
  /** Index new text in the background after each generation. */
  autoIndex: boolean;
  onnx: OnnxEmbeddingConfig;
  llama: LlamaEmbeddingConfig;
  endpoint: EndpointEmbeddingConfig;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  source: 'onnx',
  hfEndpoint: 'https://huggingface.co',
  modelsDir: '',
  npmRegistry: 'https://registry.npmjs.org',
  nugetFeed: 'https://api.nuget.org/v3-flatcontainer',
  batchSize: 16,
  maxTokens: 0,
  dimensions: 0,
  queryPrefix: null,
  docPrefix: null,
  pooling: 'auto',
  topK: 24,
  minScore: 0.35,
  vectorWeight: 1,
  queryChars: 1500,
  queryTimeoutMs: 4000,
  autoIndex: true,
  onnx: {
    model: 'bge-small-zh-v1.5',
    dtype: 'auto',
    device: 'auto',
    deviceId: 0,
    coremlUnits: 'all',
    coremlMlProgram: true,
    coremlStaticShapes: false,
    coremlSubgraphs: false,
    qnnBackend: 'htp',
    qnnBackendPath: '',
    qnnFp16: true,
    webgpuLayout: 'NCHW',
    customProviders: '',
    customRuntime: '',
    cpuFallback: true,
    intraOpThreads: 0,
    interOpThreads: 0,
    graphOptimization: 'all',
    executionMode: 'sequential',
    memArena: true,
    memPattern: true,
    logLevel: 3,
  },
  llama: {
    binary: 'managed',
    customBinary: '',
    variant: 'auto',
    release: 'latest',
    mirror: '',
    model: 'bge-m3:Q8_0',
    gpuLayers: 999,
    device: '',
    splitMode: 'default',
    mainGpu: 0,
    tensorSplit: '',
    threads: 0,
    threadsBatch: 0,
    ctxSize: 8192,
    batchSize: 2048,
    ubatchSize: 2048,
    parallel: 4,
    pooling: 'auto',
    flashAttn: 'auto',
    mlock: false,
    mmap: true,
    port: 0,
    extraArgs: '',
    env: '',
    idleMinutes: 30,
  },
  endpoint: {
    preset: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
    dimensions: 0,
    encodingFormat: 'float',
    extraBody: '',
    headers: '',
    concurrency: 2,
    timeoutMs: 60000,
    catalogModel: '',
  },
};

/** A change to the settings: any top-level field, and any fields of the engine sections. */
export type EmbeddingConfigPatch = Partial<Omit<EmbeddingConfig, 'onnx' | 'llama' | 'endpoint'>> & {
  onnx?: Partial<OnnxEmbeddingConfig>;
  llama?: Partial<LlamaEmbeddingConfig>;
  endpoint?: Partial<EndpointEmbeddingConfig>;
};

/** Settings with every field present (stored settings may predate some). */
export function normalizeEmbeddingConfig(c: EmbeddingConfigPatch | undefined): EmbeddingConfig {
  const d = DEFAULT_EMBEDDING_CONFIG;
  return { ...d, ...c, onnx: { ...d.onnx, ...c?.onnx }, llama: { ...d.llama, ...c?.llama }, endpoint: { ...d.endpoint, ...c?.endpoint } };
}

/** The catalog model the current settings run, if any. */
export function activeEmbeddingModel(c: EmbeddingConfig): EmbeddingModelInfo | undefined {
  if (c.source === 'onnx') return embeddingModel(c.onnx.model);
  if (c.source === 'llamacpp') return c.llama.model.startsWith('path:') ? undefined : embeddingModel(c.llama.model.split(':')[0]);
  return c.endpoint.catalogModel ? embeddingModel(c.endpoint.catalogModel) : undefined;
}

/** A key that changes whenever the vectors a configuration produces would change. */
export function embeddingKey(c: EmbeddingConfig): string {
  const m = activeEmbeddingModel(c);
  const model = c.source === 'onnx' ? `${c.onnx.model}|${c.onnx.dtype}` : c.source === 'llamacpp' ? c.llama.model : `${c.endpoint.baseUrl}|${c.endpoint.model}|${c.endpoint.dimensions}`;
  // Only what changes stored passage vectors: the query prefix is applied at search time.
  const parts = [c.source, model, c.dimensions, c.maxTokens, c.pooling, c.docPrefix ?? m?.docPrefix ?? ''];
  return `${c.source}-${textHash(parts.join('\u0001'))}`;
}

/** The text sent to the model for a query or a passage, with the prefixes the model was trained with. */
export function embeddingInput(c: EmbeddingConfig, text: string, kind: 'query' | 'doc'): string {
  const m = activeEmbeddingModel(c);
  const prefix = kind === 'query' ? (c.queryPrefix ?? m?.queryPrefix ?? '') : (c.docPrefix ?? m?.docPrefix ?? '');
  return prefix + text;
}

// ------------------------------------------------------------- vectors

/** A short stable hash (53 bits, base 36) of a text, used to key stored vectors by chunk content. */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Cut a vector to `dims` (Matryoshka) and scale it to unit length. */
export function finishVector(v: ArrayLike<number>, dims = 0): Float32Array {
  const n = dims > 0 && dims < v.length ? dims : v.length;
  const out = new Float32Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    out[i] = v[i];
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < n; i++) out[i] /= norm;
  return out;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
