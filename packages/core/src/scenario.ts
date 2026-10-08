import type { Placeholder, Story } from './types.ts';

/** `${key}` or `${key[default]:description}` */
const PLACEHOLDER_RE = /\$\{([^[\]:}]+)(?:\[([^\]]*)\])?(?::([^}]*))?\}/g;
/**
 * Placeholder definitions: `%{[order]key[default]:Label:Long description}`, usually at the top of the prompt.
 * They are removed from the text when the scenario starts.
 */
const DEFINITION_RE = /%\{(\d*)([^[\]:}\d][^[\]:}]*)(?:\[([^\]]*)\])?(?::([^:}]*))?(?::([^}]*))?\}\n?/g;

/** Collect placeholders used across text fields of a story. */
export function findPlaceholders(texts: string[]): Placeholder[] {
  const map = new Map<string, Placeholder & { order?: number }>();
  for (const t of texts) {
    for (const m of t.matchAll(DEFINITION_RE)) {
      const key = m[2].trim();
      map.set(key, {
        key,
        defaultValue: m[3] ?? map.get(key)?.defaultValue ?? '',
        description: m[4]?.trim() || map.get(key)?.description || key,
        longDescription: m[5]?.trim() || undefined,
        order: m[1] ? Number(m[1]) : undefined,
      });
    }
  }
  for (const t of texts) {
    for (const m of t.matchAll(PLACEHOLDER_RE)) {
      const key = m[1].trim();
      const prev = map.get(key);
      map.set(key, {
        ...prev,
        key,
        defaultValue: prev?.defaultValue || m[2] || '',
        description: prev?.description || m[3] || '',
      });
    }
  }
  const all = [...map.values()];
  // Numbered definitions come first, in their order; the rest keep the order they appear in.
  return all
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.order ?? Infinity) - (b.p.order ?? Infinity) || a.i - b.i)
    .map(({ p }) => {
      const { order: _order, ...rest } = p;
      return rest;
    });
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(DEFINITION_RE, '').replace(PLACEHOLDER_RE, (_all, key: string, def?: string) => {
    const k = key.trim();
    return values[k] ?? def ?? '';
  });
}

/** Every text field placeholders may appear in, with a label for "where is this used". */
function storyFields(s: Story): { where: string; text: string }[] {
  return [
    { where: 'Story', text: s.doc.map((d) => d.text).join('') },
    { where: 'Memory', text: s.memory },
    { where: "Author's Note", text: s.authorsNote },
    { where: 'Title', text: s.title },
    { where: 'Description', text: s.description },
    { where: 'System Prompt', text: s.systemPrompt },
    { where: 'Prefill', text: s.prefill },
    ...s.ephemeral.map((e) => ({ where: 'Ephemeral Context', text: e.text })),
    ...s.lorebook.categories.map((c) => ({ where: `Category: ${c.name}`, text: `${c.name}\n${c.entryHeader}` })),
    ...s.lorebook.entries.map((e) => ({ where: `Lorebook: ${e.displayName || e.keys[0] || 'Entry'}`, text: [e.text, e.displayName, ...e.keys].join('\n') })),
  ];
}

export function storyPlaceholders(s: Story): Placeholder[] {
  const found = findPlaceholders(storyFields(s).map((f) => f.text));
  // Explicit placeholder definitions win over inline ones.
  const explicit = new Map(s.placeholders.map((p) => [p.key, p]));
  return found.map((p) => ({ ...p, ...(explicit.get(p.key) ?? {}) }));
}

/** Where each placeholder is used (field labels), for the scenario import dialog. */
export function placeholderUses(s: Story): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of storyFields(s)) {
    for (const m of f.text.matchAll(PLACEHOLDER_RE)) {
      const key = m[1].trim();
      const list = out.get(key) ?? [];
      if (!list.includes(f.where)) list.push(f.where);
      out.set(key, list);
    }
  }
  return out;
}

/** Apply placeholder values to every text field of a story. */
export function applyPlaceholders(s: Story, values: Record<string, string>): Story {
  const f = (t: string) => fillPlaceholders(t, values);
  return {
    ...s,
    title: f(s.title),
    description: f(s.description),
    memory: f(s.memory),
    authorsNote: f(s.authorsNote),
    systemPrompt: f(s.systemPrompt),
    prefill: f(s.prefill),
    doc: s.doc.map((sp) => ({ ...sp, text: f(sp.text) })),
    ephemeral: s.ephemeral.map((e) => ({ ...e, text: f(e.text) })),
    lorebook: {
      ...s.lorebook,
      categories: s.lorebook.categories.map((c) => ({ ...c, name: f(c.name), entryHeader: f(c.entryHeader) })),
      entries: s.lorebook.entries.map((e) => ({ ...e, text: f(e.text), displayName: f(e.displayName), keys: e.keys.map(f) })),
    },
    placeholders: [],
  };
}
