// Script metadata: a JSON block at the top of the script, e.g.
//
//   /*@meta
//   {
//     "name": "Find & Replace",
//     "description": "Replace text across the whole story.",
//     "author": "NovelWriter",
//     "version": "1.0",
//     "permissions": ["documentEdit"],
//     "config": [{ "id": "caseSensitive", "type": "boolean", "label": "Case sensitive", "default": false }]
//   }
//   */

export type Permission = 'clipboardWrite' | 'fileDownload' | 'storyEdit' | 'documentEdit' | 'lorebookEdit' | 'editorDecorations' | 'presetEdit';

export const PERMISSIONS: Record<Permission, string> = {
  clipboardWrite: 'Write to your clipboard',
  fileDownload: 'Download files to your computer',
  storyEdit: "Change the story's title, Memory, Author's Note and system prompt",
  documentEdit: 'Edit the story text',
  lorebookEdit: 'Create, change and delete lorebook entries',
  editorDecorations: 'Highlight and style text in the editor',
  presetEdit: 'Change generation settings',
};

export interface ConfigField {
  id: string;
  type: 'boolean' | 'string' | 'text' | 'number' | 'select';
  label: string;
  description?: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface ScriptMeta {
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  permissions: Permission[];
  config: ConfigField[];
}

const META_RE = /\/\*@meta\s*([\s\S]*?)\*\//;

export function parseMeta(code: string): { meta: ScriptMeta; error?: string } {
  const empty: ScriptMeta = { permissions: [], config: [] };
  const m = META_RE.exec(code);
  if (!m) return { meta: empty };
  try {
    const raw = JSON.parse(m[1]) as Partial<ScriptMeta>;
    const permissions = (Array.isArray(raw.permissions) ? raw.permissions : []).filter((p): p is Permission => p in PERMISSIONS);
    const config = (Array.isArray(raw.config) ? raw.config : []).filter((c) => c && typeof c.id === 'string');
    return { meta: { ...raw, permissions, config } };
  } catch (e) {
    return { meta: empty, error: `@meta: ${(e as Error).message}` };
  }
}

/** Config values with defaults filled in. */
export function configValues(meta: ScriptMeta, saved: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of meta.config) out[f.id] = saved && f.id in saved ? saved[f.id] : (f.default ?? (f.type === 'boolean' ? false : f.type === 'number' ? 0 : ''));
  return out;
}

/** CSS a script may set on decorated text. Anything else is dropped. */
const SAFE_CSS = new Set(['color', 'background', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-color', 'text-decoration-style', 'opacity', 'border-bottom', 'outline', 'border-radius', 'filter', 'letter-spacing']);
export function safeStyle(style: Record<string, string> | undefined): string {
  if (!style) return '';
  return Object.entries(style)
    .map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(v)] as const)
    .filter(([k, v]) => SAFE_CSS.has(k) && !/url\s*\(|expression|[;{}<>]/i.test(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}
