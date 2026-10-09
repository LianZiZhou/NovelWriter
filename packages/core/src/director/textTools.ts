import { uid } from '../util.ts';
import type { ChatMessage } from '../types.ts';
import type { DirectorMessage, DirectorToolCall, ToolSpec } from './types.ts';

/**
 * Tool calling for models that have no native tool API (local models run as text completion): the tools are
 * described in the system prompt and the model writes each call as a fenced ```tool block of JSON.
 */
export function textToolManifest(tools: ToolSpec[]): string {
  const list = tools.map((t) => `### ${t.name}\n${t.description}\nArguments (JSON Schema): ${JSON.stringify(t.parameters)}`).join('\n\n');
  return (
    '# Tools\nYou act by calling tools. To call one, write a fenced block like this (one block per call; several blocks per reply are fine):\n\n' +
    '```tool\n{"name": "tool_name", "arguments": {"key": "value"}}\n```\n\n' +
    'After your calls, stop and wait: the results come back in the next message. Text outside tool blocks is shown to the author as your thinking.\n\n' +
    list
  );
}

const BLOCK = /```(?:tool|tool_call|json)?\s*\n?([\s\S]*?)```|<tool_call>([\s\S]*?)<\/tool_call>/g;

/** Find tool calls in a model's reply; returns the remaining text and the calls. */
export function parseTextToolCalls(reply: string): { text: string; toolCalls: DirectorToolCall[] } {
  const toolCalls: DirectorToolCall[] = [];
  const text = reply.replace(BLOCK, (whole, a: string | undefined, b: string | undefined) => {
    const body = (a ?? b ?? '').trim();
    const call = parseCall(body);
    if (!call) return whole;
    toolCalls.push(call);
    return '';
  });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), toolCalls };
}

function parseCall(body: string): DirectorToolCall | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    // Models often leave a trailing comma or wrap the JSON in prose.
    const m = /\{[\s\S]*\}/.exec(body);
    if (!m) return null;
    try {
      v = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = o.name ?? o.tool ?? (o.function as Record<string, unknown> | undefined)?.name;
  if (typeof name !== 'string' || !name) return null;
  let args = o.arguments ?? o.args ?? o.parameters ?? o.input ?? (o.function as Record<string, unknown> | undefined)?.arguments ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  return { id: uid(), name, args: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> };
}

/** The transcript as plain chat turns for a text-protocol model: calls written back as tool blocks, results as user turns. */
export function textTranscript(messages: DirectorMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const push = (role: ChatMessage['role'], content: string) => {
    const last = out[out.length - 1];
    if (last?.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', m.content);
    else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).map((c) => '```tool\n' + JSON.stringify({ name: c.name, arguments: c.args }) + '\n```');
      push('assistant', [m.content, ...calls].filter(Boolean).join('\n\n') || '(no reply)');
    } else push('user', `[Result of ${m.name}${m.isError ? ' — error' : ''}]\n${m.content}`);
  }
  return out;
}
