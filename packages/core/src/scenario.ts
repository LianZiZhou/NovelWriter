import type { Placeholder, Story } from './types.ts';

/** `${key}` or `${key[default]:description}` */
const PLACEHOLDER_RE = /\$\{([^[\]:}]+)(?:\[([^\]]*)\])?(?::([^}]*))?\}/g;

/** Collect placeholders used across text fields of a story. */
export function findPlaceholders(texts: string[]): Placeholder[] {
  const map = new Map<string, Placeholder>();
  for (const t of texts) {
    for (const m of t.matchAll(PLACEHOLDER_RE)) {
      const key = m[1].trim();
      const prev = map.get(key);
      map.set(key, {
        key,
        defaultValue: m[2] ?? prev?.defaultValue ?? '',
        description: m[3] ?? prev?.description ?? '',
      });
    }
  }
  return [...map.values()];
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (_all, key: string, def?: string) => {
    const k = key.trim();
    return values[k] ?? def ?? '';
  });
}

function storyTexts(s: Story): string[] {
  return [
    s.doc.map((d) => d.text).join(''),
    s.memory,
    s.authorsNote,
    s.title,
    s.description,
    ...s.lorebook.entries.flatMap((e) => [e.text, e.displayName, ...e.keys]),
  ];
}

export function storyPlaceholders(s: Story): Placeholder[] {
  const found = findPlaceholders(storyTexts(s));
  // Explicit placeholder definitions win over inline ones.
  const explicit = new Map(s.placeholders.map((p) => [p.key, p]));
  return found.map((p) => ({ ...p, ...(explicit.get(p.key) ?? {}) }));
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
    doc: s.doc.map((sp) => ({ ...sp, text: f(sp.text) })),
    lorebook: {
      ...s.lorebook,
      entries: s.lorebook.entries.map((e) => ({ ...e, text: f(e.text), displayName: f(e.displayName), keys: e.keys.map(f) })),
    },
    placeholders: [],
  };
}
