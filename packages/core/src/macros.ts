/**
 * `{{macros}}` in Memory, Author's Note, lore entries, ephemeral entries and the system prompt (after SillyTavern).
 * The story text itself is never expanded.
 *
 * - `{{// note}}` is dropped; `{{trim}}` removes the whitespace around it; `{{newline}}` is a line break.
 * - `{{title}}`, `{{author}}`, `{{genre}}`, `{{tags}}`, `{{step}}`: the story's fields.
 * - `{{date}}`, `{{time}}`, `{{weekday}}`, `{{isodate}}`: now.
 * - `{{random::a::b::c}}` (or `{{random:a,b,c}}`): a fresh pick each generation.
 * - `{{pick::a::b::c}}`: a pick that stays the same for this story.
 * - `{{roll:2d6}}` / `{{roll:20}}`: dice.
 * - `{{getvar::name}}`, `{{setvar::name::value}}`, `{{addvar::name::n}}`, `{{incvar::name}}`, `{{decvar::name}}`:
 *   story variables, kept with the story between generations.
 */
export interface MacroEnv {
  title: string;
  author: string;
  genre: string;
  tags: string[];
  step: number;
  /** Seed for `{{pick}}` (the story id), so picks don't change between generations. */
  seed: string;
  vars: Record<string, string>;
  random: () => number;
  now?: Date;
}

const MAX_PASSES = 8;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function options(arg: string): string[] {
  if (arg.startsWith('::')) return arg.slice(2).split('::');
  if (arg.startsWith(':')) return arg.slice(1).split(',').map((x) => x.trim());
  return [];
}

function roll(spec: string, random: () => number): string {
  const m = /^\s*(\d*)d?(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(spec);
  if (!m) return '';
  const count = spec.toLowerCase().includes('d') ? Math.min(100, Number(m[1] || 1)) : 1;
  const sides = Math.max(1, Number(m[2]));
  let total = Number((m[3] ?? '0').replace(/\s/g, ''));
  for (let i = 0; i < count; i++) total += 1 + Math.floor(random() * sides);
  return String(total);
}

function expandOne(body: string, env: MacroEnv, at: number): string | null {
  const name = /^[a-z/]+/i.exec(body)?.[0]?.toLowerCase() ?? '';
  const arg = body.slice(name.length);
  const now = env.now ?? new Date();
  const vars = env.vars;
  switch (name) {
    case '//':
      return '';
    case 'newline':
      return '\n';
    case 'title':
      return env.title;
    case 'author':
      return env.author;
    case 'genre':
      return env.genre;
    case 'tags':
      return env.tags.join(', ');
    case 'step':
      return String(env.step);
    case 'date':
      return now.toLocaleDateString();
    case 'isodate':
      return now.toISOString().slice(0, 10);
    case 'time':
      return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'weekday':
      return now.toLocaleDateString(undefined, { weekday: 'long' });
    case 'random': {
      const o = options(arg);
      return o.length ? o[Math.floor(env.random() * o.length)] : '';
    }
    case 'pick': {
      const o = options(arg);
      return o.length ? o[hash(`${env.seed}:${at}:${arg}`) % o.length] : '';
    }
    case 'roll':
      return roll(arg.replace(/^:+/, ''), env.random);
    case 'getvar':
      return vars[arg.replace(/^:+/, '').trim()] ?? '';
    case 'setvar': {
      const [k, ...v] = arg.replace(/^::/, '').split('::');
      if (k.trim()) vars[k.trim()] = v.join('::');
      return '';
    }
    case 'addvar': {
      const [k, v = ''] = arg.replace(/^::/, '').split('::');
      const key = k.trim();
      if (!key) return '';
      const cur = vars[key] ?? '';
      const a = Number(cur);
      const b = Number(v);
      vars[key] = cur !== '' && Number.isFinite(a) && v.trim() !== '' && Number.isFinite(b) ? String(a + b) : cur + v;
      return '';
    }
    case 'incvar':
    case 'decvar': {
      const key = arg.replace(/^:+/, '').trim();
      if (!key) return '';
      const n = Number(vars[key] ?? 0) || 0;
      vars[key] = String(n + (name === 'incvar' ? 1 : -1));
      return '';
    }
  }
  return null;
}

/** Expand the macros in `text`. Unknown macros are left as they are. */
export function expandMacros(text: string, env: MacroEnv | undefined): string {
  if (!env || !text.includes('{{')) return text;
  let out = text;
  for (let pass = 0; pass < MAX_PASSES && out.includes('{{'); pass++) {
    let changed = false;
    // Innermost first, so `{{random::{{getvar::a}}::b}}` works.
    out = out.replace(/\{\{((?:(?!\{\{|\}\})[\s\S])*)\}\}/g, (whole, body: string, at: number) => {
      if (body.trim().toLowerCase() === 'trim') return whole;
      const r = expandOne(body.trim(), env, at);
      if (r === null) return `\u0000${body}\u0001`;
      changed = true;
      return r;
    });
    if (!changed) break;
  }
  out = out.replace(/\s*\{\{\s*trim\s*\}\}\s*/gi, '');
  return out.replace(/\u0000/g, '{{').replace(/\u0001/g, '}}');
}
