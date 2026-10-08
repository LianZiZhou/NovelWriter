/** Hotkey actions in the original's order. Bindings are "Mod-Shift-Enter" specs; several are joined with "|". */
export const HOTKEY_LABELS: Record<string, string> = {
  toggleMenuBar: 'Toggle Menu Bar',
  toggleInfoBar: 'Toggle Info Bar',
  toggleBars: 'Toggle Bars',
  focusEditor: 'Focus Editor',
  send: 'Request AI Generation',
  inline: 'Generate Inline',
  stop: 'Cancel AI Generation',
  focusInput: 'Focus Input Field',
  redo: 'Redo',
  redoList: 'Open Redo List',
  undo: 'Undo',
  retry: 'Retry AI Generation',
  lorebook: 'Open Lorebook',
  contextViewer: 'Open Context Viewer',
  userScripts: 'Open User Scripts Modal',
  tokenizer: 'Open Tokenizer',
  tokenProbs: 'Open Token Probabilities',
  editorTokenProbs: 'Toggle Editor Token Probabilities',
  closeModal: 'Close Modal',
  toggleInputBox: 'Toggle Input Box',
  toggleHighlighting: 'Toggle Highlighting',
  toggleSpellcheck: 'Toggle Spellcheck',
  newStory: 'Create New Story',
  resetTheme: 'Reset Theme',
  deleteStory: 'Delete Current Story',
  stopTTS: 'Stop TTS',
  palette: 'Command Palette',
  settings: 'Open Settings',
  find: 'Find',
  bold: 'Toggle Bold',
  italic: 'Toggle Italic',
  underline: 'Toggle Underline',
  strike: 'Toggle Strikethrough',
};

/** Bindings handled by the editor itself; shown but not rebindable. */
export const FIXED_HOTKEYS = new Set(['closeModal', 'bold', 'italic', 'underline', 'strike', 'find']);

/** Bump when defaults change so saved maps from older versions are replaced. */
export const HOTKEYS_VERSION = 3;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function hotkeyParts(spec: string): { glyph?: string; label: string }[] {
  return spec.split('-').map((p) => {
    if (p === 'Mod') return isMac ? { glyph: '⌘', label: 'Cmd' } : { glyph: '^', label: 'Ctrl' };
    if (p === 'Alt') return { glyph: '⌥', label: 'Alt' };
    if (p === 'Shift') return { glyph: '⇧', label: 'Shift' };
    if (p === 'ArrowLeft') return { label: '←' };
    if (p === 'ArrowRight') return { label: '→' };
    return { label: p.length === 1 ? p.toUpperCase() : p };
  });
}

export function formatHotkey(spec: string): string {
  return spec
    .split('|')
    .map((one) =>
      hotkeyParts(one)
        .map((p) => p.label)
        .join(' + '),
    )
    .join(' | ');
}

/** Does the keyboard event match a spec like "Mod-Shift-Enter" (or any of "a|b")? */
export function matchHotkey(e: KeyboardEvent, spec: string | undefined): boolean {
  if (!spec) return false;
  if (spec.includes('|')) return spec.split('|').some((one) => matchHotkey(e, one));
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
