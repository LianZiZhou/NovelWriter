// OpenAI-compatible `/embeddings` endpoints: cloud APIs and local servers (Ollama, LM Studio, vLLM, TEI,
// OpenVINO Model Server, FastFlowLM on AMD NPUs, …), and the llama.cpp server NovelWriter runs itself.
import type { EmbeddingConfig } from '@novelwriter/core';

export interface EndpointCall {
  baseUrl: string;
  apiKey?: string;
  model: string;
  dimensions?: number;
  encodingFormat?: 'float' | 'base64';
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function decodeBase64(s: string): Float32Array {
  const buf = Buffer.from(s, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export async function embedEndpoint(texts: string[], c: EndpointCall): Promise<Float32Array[]> {
  const timeout = AbortSignal.timeout(c.timeoutMs || 60000);
  const signal = c.signal ? AbortSignal.any([c.signal, timeout]) : timeout;
  const body: Record<string, unknown> = { model: c.model, input: texts, ...c.extraBody };
  if (c.encodingFormat === 'base64') body.encoding_format = 'base64';
  if (c.dimensions) body.dimensions = c.dimensions;
  const res = await fetch(`${c.baseUrl.replace(/\/+$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}), ...c.headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `Embedding endpoint returned HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } | string; detail?: string; message?: string };
      msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.detail ?? j.message ?? msg);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  const json = (await res.json()) as { data?: { embedding: number[] | string; index?: number }[]; embeddings?: number[][] };
  if (json.embeddings) return json.embeddings.map((e) => Float32Array.from(e));
  const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== texts.length) throw new Error(`The endpoint returned ${data.length} embeddings for ${texts.length} texts.`);
  return data.map((d) => (typeof d.embedding === 'string' ? decodeBase64(d.embedding) : Float32Array.from(d.embedding)));
}

function json<T>(s: string, what: string): T | undefined {
  if (!s.trim()) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new Error(`${what} is not valid JSON.`);
  }
}

/** The call for the configured endpoint; Voyage and Jina also learn whether the text is a query or a passage. */
export function endpointCall(cfg: EmbeddingConfig, kind: 'query' | 'doc', signal?: AbortSignal): EndpointCall {
  const e = cfg.endpoint;
  if (!e.baseUrl.trim()) throw new Error('Set the embedding endpoint URL in Settings → Vector Search.');
  const extra: Record<string, unknown> = {};
  if (e.preset === 'voyage') extra.input_type = kind === 'query' ? 'query' : 'document';
  if (e.preset === 'jina') extra.task = kind === 'query' ? 'retrieval.query' : 'retrieval.passage';
  return {
    baseUrl: e.baseUrl,
    apiKey: e.apiKey,
    model: e.model,
    dimensions: e.dimensions || undefined,
    encodingFormat: e.encodingFormat,
    extraBody: { ...extra, ...json<Record<string, unknown>>(e.extraBody, 'Extra request body') },
    headers: json<Record<string, string>>(e.headers, 'Extra headers'),
    timeoutMs: e.timeoutMs,
    signal,
  };
}
