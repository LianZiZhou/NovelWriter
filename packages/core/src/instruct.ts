import type { ChatMessage } from './types.ts';

/**
 * Instruct templates for running chat-tuned local models as plain text completion (after SillyTavern's instruct
 * mode): the request is rendered into the model's own chat format and left open inside the reply, so a story-tail
 * prefill is continued word for word. The server adds the BOS token itself, so none is written here.
 */
export interface InstructTemplate {
  id: InstructTemplateId;
  name: string;
  system: [string, string];
  user: [string, string];
  assistant: [string, string];
  /** The model has no system role: the system prompt opens the first user message. */
  noSystemRole?: boolean;
  stop: string[];
}

export type InstructTemplateId = 'chatml' | 'llama3' | 'mistral' | 'gemma' | 'glm4' | 'deepseek' | 'alpaca';

export const INSTRUCT_TEMPLATES: Record<InstructTemplateId, InstructTemplate> = {
  chatml: {
    id: 'chatml',
    name: 'ChatML (Qwen, Yi, many fine-tunes)',
    system: ['<|im_start|>system\n', '<|im_end|>\n'],
    user: ['<|im_start|>user\n', '<|im_end|>\n'],
    assistant: ['<|im_start|>assistant\n', '<|im_end|>\n'],
    stop: ['<|im_end|>', '<|im_start|>'],
  },
  llama3: {
    id: 'llama3',
    name: 'Llama 3',
    system: ['<|start_header_id|>system<|end_header_id|>\n\n', '<|eot_id|>'],
    user: ['<|start_header_id|>user<|end_header_id|>\n\n', '<|eot_id|>'],
    assistant: ['<|start_header_id|>assistant<|end_header_id|>\n\n', '<|eot_id|>'],
    stop: ['<|eot_id|>', '<|start_header_id|>'],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral (v7)',
    system: ['[SYSTEM_PROMPT]', '[/SYSTEM_PROMPT]'],
    user: ['[INST]', '[/INST]'],
    assistant: ['', '</s>'],
    stop: ['</s>', '[INST]'],
  },
  gemma: {
    id: 'gemma',
    name: 'Gemma',
    system: ['', ''],
    user: ['<start_of_turn>user\n', '<end_of_turn>\n'],
    assistant: ['<start_of_turn>model\n', '<end_of_turn>\n'],
    noSystemRole: true,
    stop: ['<end_of_turn>', '<start_of_turn>'],
  },
  glm4: {
    id: 'glm4',
    name: 'GLM-4',
    system: ['<|system|>\n', ''],
    user: ['<|user|>\n', ''],
    assistant: ['<|assistant|>\n', ''],
    stop: ['<|user|>', '<|observation|>', '<|endoftext|>'],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek V3 / R1',
    system: ['', ''],
    user: ['<｜User｜>', ''],
    assistant: ['<｜Assistant｜>', '<｜end▁of▁sentence｜>'],
    stop: ['<｜end▁of▁sentence｜>', '<｜User｜>'],
  },
  alpaca: {
    id: 'alpaca',
    name: 'Alpaca',
    system: ['', '\n\n'],
    user: ['### Instruction:\n', '\n\n'],
    assistant: ['### Response:\n', '\n\n'],
    stop: ['### Instruction:', '### Input:'],
  },
};

/**
 * The template for a model, from its Jinja chat template when the server reports one (llama.cpp `/props`),
 * else from the model's name. ChatML is the fallback: it is the most common format among fine-tunes.
 */
export function detectTemplate(modelId: string, chatTemplate = ''): InstructTemplateId {
  const t = chatTemplate;
  if (t) {
    if (t.includes('<|im_start|>')) return 'chatml';
    if (t.includes('<|start_header_id|>')) return 'llama3';
    if (t.includes('<start_of_turn>')) return 'gemma';
    if (t.includes('[INST]')) return 'mistral';
    if (t.includes('<｜User｜>') || t.includes('<｜Assistant｜>')) return 'deepseek';
    if (t.includes('<|user|>') && t.includes('<|assistant|>')) return 'glm4';
    if (t.includes('### Instruction')) return 'alpaca';
  }
  const id = modelId.toLowerCase();
  if (/llama[-_ .]?3|llama-?4/.test(id)) return 'llama3';
  if (/gemma/.test(id)) return 'gemma';
  if (/mistral|mixtral|magistral|ministral|nemo|cydonia|pixtral/.test(id)) return 'mistral';
  if (/deepseek/.test(id)) return 'deepseek';
  if (/glm/.test(id)) return 'glm4';
  return 'chatml';
}

/**
 * Render a chat request in an instruct template, ending inside the model's reply: a final assistant message is
 * left open to be continued, otherwise an empty reply is opened. Qwen 3's thinking is switched off with an
 * empty think block, as its chat template does.
 */
export function renderInstruct(tpl: InstructTemplate, system: string | undefined, messages: ChatMessage[], opts: { modelId?: string } = {}): string {
  let out = '';
  let pendingSystem = system?.trim() ? system.trim() : '';
  if (pendingSystem && !tpl.noSystemRole) {
    out += tpl.system[0] + pendingSystem + tpl.system[1];
    pendingSystem = '';
  }
  const last = messages.length - 1;
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      const content = pendingSystem ? `${pendingSystem}\n\n${m.content}` : m.content;
      pendingSystem = '';
      out += tpl.user[0] + content + tpl.user[1];
    } else {
      out += tpl.assistant[0] + (i === last ? '' : m.content + tpl.assistant[1]);
      if (i === last) out += thinkOff(tpl, opts.modelId) + m.content;
    }
  });
  if (pendingSystem) out += tpl.user[0] + pendingSystem + tpl.user[1];
  if (!messages.length || messages[last].role === 'user' || pendingSystem) out += tpl.assistant[0] + thinkOff(tpl, opts.modelId);
  return out;
}

function thinkOff(tpl: InstructTemplate, modelId = ''): string {
  return tpl.id === 'chatml' && /qwen-?3/i.test(modelId) ? '<think>\n\n</think>\n\n' : '';
}

/**
 * Drop a reasoning model's thinking from its output: `<think>…</think>` blocks, and an unfinished one at the start
 * (while it is still thinking, nothing is shown).
 */
export function stripThinking(text: string): string {
  if (!/<\/?think(?:ing)?>/i.test(text)) return text;
  let out = text.replace(/<(think(?:ing)?)>[\s\S]*?<\/\1>\s*/gi, '');
  // Some templates open the think block in the prompt, so only its end arrives.
  const end = /^[\s\S]*?<\/think(?:ing)?>\s*/i.exec(out);
  if (end && !/<think(?:ing)?>/i.test(end[0])) out = out.slice(end[0].length);
  if (/^\s*<think(?:ing)?>/i.test(out)) return '';
  return out;
}
