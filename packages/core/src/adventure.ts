export type AdventureInputMode = 'do' | 'say' | 'story';

const DIRECTIONS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
  u: 'up',
  d: 'down',
};

const SPECIAL: Record<string, string> = {
  l: 'look around',
  i: 'check your inventory',
  z: 'wait',
};

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function endPunct(s: string): string {
  return /[.!?…"”]$/.test(s) ? s : s + '.';
}

/**
 * Convert player input to the text inserted into the story. Actions are
 * prefixed with `> ` (hidden in the editor, visible to the AI).
 */
export function adventureInput(raw: string, mode: AdventureInputMode): string {
  let input = raw.trim();
  if (!input) return '';
  if (mode === 'story') return input;

  // `!` passes input through unchanged (except the hidden `>`).
  if (input.startsWith('!') && input.length > 1) return `> ${input.slice(1).trim()}`;

  // Shortcuts switching mode.
  if (mode === 'do' && input.startsWith('"')) {
    mode = 'say';
    input = input.replace(/^"|"$/g, '');
  } else if (mode === 'say' && input.startsWith('>')) {
    mode = 'do';
    input = input.slice(1).trim();
  }

  if (mode === 'do') {
    if (input === '!') return '> You do something unexpected';
    if (input === '?') return '> You wonder';
    const lower = input.toLowerCase();
    if (SPECIAL[lower]) return `> You ${SPECIAL[lower]}.`;
    if (DIRECTIONS[lower]) return `> You go ${DIRECTIONS[lower]}.`;
    const x = /^x\s+(.+)$/i.exec(input);
    if (x) return `> You examine ${x[1].replace(/[.]$/, '')}.`;
    const wildcard = /[*,]$/.test(input);
    let body = input.replace(/[*]$/, '');
    body = body.replace(/^(you|i)\s+/i, '');
    body = body[0].toLowerCase() + body.slice(1);
    return wildcard ? `> You ${body}` : `> You ${endPunct(body)}`;
  }

  // say
  if (input === '!') return '> You yell';
  if (input === '?') return '> You ask';
  const wildcard = /[*,]$/.test(input);
  const text = capitalize(input.replace(/[*]$/, ''));
  if (wildcard) return `> You say "${text}`;
  const verb = text.endsWith('?') ? 'ask' : text.endsWith('!') ? 'yell' : 'say';
  return `> You ${verb}, "${endPunct(text)}"`;
}

/** Strip the hidden `>` action marker for display. */
export function displayAction(line: string): string {
  return line.replace(/^>\s?/, '');
}

export function isActionLine(line: string): boolean {
  return /^>/.test(line);
}
