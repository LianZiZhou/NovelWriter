/**
 * Local models for the text-analysis pipeline, managed like the embedding models: each task works without one (the
 * rules in this folder), and a downloaded model takes over where it does better. They run on the ONNX runtime the
 * embeddings install, in their own worker.
 *
 * Picked from published evaluations (FLORES-200, the SaT paper's benchmarks) among models with ONNX files and a
 * permissive licence. None of the punctuation models predicts `!`: exclamations stay with the rules.
 */
import { LANGS, type Lang } from './lang.ts';

export type NlpTask = 'punctuation' | 'segmentation' | 'language' | 'entities';
export const NLP_TASKS: NlpTask[] = ['punctuation', 'segmentation', 'language', 'entities'];

/**
 * How a model is run: `token` and `sequence` through transformers.js (token / text classification), `sat` as a
 * raw ONNX graph (Segment any Text has no transformers.js model class).
 */
export type NlpRunner = 'token' | 'sequence' | 'sat';

export interface NlpModelInfo {
  id: string;
  task: NlpTask;
  name: string;
  /** Model page. */
  repo: string;
  runner: NlpRunner;
  /** transformers.js dtype of the graph (`q8` = `onnx/model_quantized.onnx`). */
  dtype?: string;
  /** Files to fetch from Hugging Face, saved under the model's folder (as `as`, when the name differs). */
  files: { repo: string; path: string; as?: string }[];
  sizeMB: number;
  languages: string;
  license: string;
  /** What it is good for, shown under the choice. */
  note: string;
}

const TJS = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json'];
const tjs = (repo: string, graph: string) => [...TJS.map((path) => ({ repo, path })), { repo, path: `onnx/${graph}` }];
// SaT uses XLM-RoBERTa's tokenizer, which its repos don't carry.
const XLMR = [
  { repo: 'FacebookAI/xlm-roberta-base', path: 'tokenizer.json' },
  { repo: 'FacebookAI/xlm-roberta-base', path: 'tokenizer_config.json' },
];

export const NLP_MODELS: NlpModelInfo[] = [
  {
    id: 'punct-horizon-small',
    task: 'punctuation',
    name: 'Horizon Punctuation Small',
    repo: 'Horizon-Labs/punctuation-restoration-small',
    runner: 'token',
    dtype: 'q8',
    files: tjs('Horizon-Labs/punctuation-restoration-small', 'model_quantized.onnx'),
    sizeMB: 288,
    languages: '88 languages incl. zh, ja, ko, en',
    license: 'Apache-2.0',
    note: 'mmBERT, FLORES-200 F1 0.84 (zh 0.83, ja 0.91). Marks . , ? : after each word.',
  },
  {
    id: 'punct-horizon-base',
    task: 'punctuation',
    name: 'Horizon Punctuation Base',
    repo: 'Horizon-Labs/punctuation-restoration-base',
    runner: 'token',
    dtype: 'q8',
    files: tjs('Horizon-Labs/punctuation-restoration-base', 'model_quantized.onnx'),
    sizeMB: 644,
    languages: '88 languages incl. zh, ja, ko, en',
    license: 'Apache-2.0',
    note: 'The larger mmBERT: a little more accurate, about twice as slow.',
  },
  {
    id: 'punct-kredor-all',
    task: 'punctuation',
    name: 'punctuate-all',
    repo: 'kredor/punctuate-all',
    runner: 'token',
    dtype: 'q8',
    files: tjs('onnx-community/punctuate-all-ONNX', 'model_quantized.onnx'),
    sizeMB: 282,
    languages: '12 European languages',
    license: 'MIT',
    note: 'XLM-RoBERTa trained on Europarl. For European languages only.',
  },
  {
    id: 'sat-3l-sm',
    task: 'segmentation',
    name: 'SaT 3L-SM (int8)',
    repo: 'segment-any-text/sat-3l-sm',
    runner: 'sat',
    files: [{ repo: 'ModelCloud/sat-3l-sm-int8-onnx', path: 'model.onnx' }, { repo: 'segment-any-text/sat-3l-sm', path: 'config.json' }, ...XLMR],
    sizeMB: 213,
    languages: '85 languages',
    license: 'MIT',
    note: 'Segment any Text: finds sentence ends with or without punctuation. Multilingual F1 93.5.',
  },
  {
    id: 'sat-12l-sm',
    task: 'segmentation',
    name: 'SaT 12L-SM',
    repo: 'segment-any-text/sat-12l-sm',
    runner: 'sat',
    files: [{ repo: 'segment-any-text/sat-12l-sm', path: 'model_optimized.onnx', as: 'model.onnx' }, { repo: 'segment-any-text/sat-12l-sm', path: 'config.json' }, ...XLMR],
    sizeMB: 539,
    languages: '85 languages',
    license: 'MIT',
    note: 'The most accurate SaT (multilingual F1 96.0), slower.',
  },
  {
    id: 'lid-horizon-small',
    task: 'language',
    name: 'Horizon Language Detection Small',
    repo: 'Horizon-Labs/language-detection-small',
    runner: 'sequence',
    dtype: 'q8',
    files: tjs('Horizon-Labs/language-detection-small', 'model_quantized.onnx'),
    sizeMB: 289,
    languages: '183 languages',
    license: 'Apache-2.0',
    note: 'FLORES-200 accuracy 0.98, 0.87 on the first 20 to 40 characters (ahead of GlotLID and NLLB LID).',
  },
  {
    id: 'lid-papluca',
    task: 'language',
    name: 'XLM-R Language Detection',
    repo: 'papluca/xlm-roberta-base-language-detection',
    runner: 'sequence',
    dtype: 'q8',
    files: tjs('onnx-community/xlm-roberta-base-language-detection-ONNX', 'model_quantized.onnx'),
    sizeMB: 282,
    languages: '20 languages (no Korean)',
    license: 'MIT',
    note: 'Widely used, 99.6% on its test set; fewer languages.',
  },
  {
    id: 'ner-mbert-hrl',
    task: 'entities',
    name: 'mBERT NER (HRL)',
    repo: 'Davlan/bert-base-multilingual-cased-ner-hrl',
    runner: 'token',
    dtype: 'q8',
    files: tjs('Xenova/bert-base-multilingual-cased-ner-hrl', 'model_quantized.onnx'),
    sizeMB: 173,
    languages: 'ar de en es fr it lv nl pt zh',
    license: 'AFL-3.0',
    note: 'People, places, organisations and dates.',
  },
];

export function nlpModel(id: string): NlpModelInfo | undefined {
  return NLP_MODELS.find((m) => m.id === id);
}

export interface NlpConfig {
  /** Model per task; empty = the built-in rules only. */
  models: Record<NlpTask, string>;
}

export const DEFAULT_NLP_CONFIG: NlpConfig = {
  models: { punctuation: '', segmentation: '', language: '', entities: '' },
};

/** The runtime settings (execution provider, threads…) are the embeddings' ONNX settings, shared by both. */
export type NlpConfigPatch = { models?: Partial<Record<NlpTask, string>> };

export function normalizeNlpConfig(c: NlpConfigPatch | undefined): NlpConfig {
  return { models: { ...DEFAULT_NLP_CONFIG.models, ...c?.models } };
}

// ------------------------------------------------------------- results

/** A model's punctuation of one text: the text with its marks, and how likely the text as a whole asks something. */
export interface PunctuationResult {
  text: string;
  /** Probability that the last word is followed by `?`. */
  question: number;
}

export interface LanguageResult {
  /** The model's label, e.g. `zho_Hani` or `zh`. */
  label: string;
  /** The label as one of the pipeline's languages, when it is one. */
  lang: Lang | null;
  score: number;
}

export interface EntityResult {
  text: string;
  /** PER, LOC, ORG, DATE… */
  type: string;
  score: number;
  count: number;
}

/** ISO 639-3 (FLORES `zho_Hani`) and 639-1 labels to the pipeline's languages. */
const ISO3: Record<string, Lang> = {
  zho: 'zh', cmn: 'zh', yue: 'zh', jpn: 'ja', kor: 'ko', eng: 'en', rus: 'ru', ukr: 'uk', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', nld: 'nl',
  arb: 'ar', ara: 'ar', pes: 'fa', fas: 'fa', heb: 'he', ell: 'el', hin: 'hi', hye: 'hy', kat: 'ka', amh: 'am', mya: 'my', tha: 'th',
};

export function langFromLabel(label: string): Lang | null {
  const base = label.toLowerCase().split(/[_-]/)[0];
  const lang = ISO3[base] ?? base;
  return (LANGS as string[]).includes(lang) ? (lang as Lang) : null;
}
