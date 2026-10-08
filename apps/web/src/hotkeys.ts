export const HOTKEY_LABELS: Record<string, string> = {
  send: 'Send',
  inline: 'Generate Inline',
  retry: 'Retry',
  undo: 'Undo',
  redo: 'Redo',
  stop: 'Stop',
  lorebook: 'Lorebook',
  palette: 'Command Palette',
  toggleLeft: 'Toggle left sidebar',
  toggleRight: 'Toggle right sidebar',
  newStory: 'New Story',
  settings: 'Open Settings',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatHotkey(spec: string): string {
  return spec
    .split('-')
    .map((p) => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Enter' ? '⏎' : p.length === 1 ? p.toUpperCase() : p))
    .join(' + ');
}

/** Does the keyboard event match a spec like "Mod-Shift-Enter"? */
export function matchHotkey(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split('-');
  const key = parts.pop()!;
  const mod = parts.includes('Mod');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  if ((e.ctrlKey || e.metaKey) !== mod || e.shiftKey !== shift || e.altKey !== alt) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // Alt+letter produces special characters on macOS; fall back to the physical key.
  const code = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code;
  return k === key.toLowerCase() || code === key.toLowerCase() || (key === ',' && e.code === 'Comma');
}
