import type { Theme } from './themes.ts';

/** Source Sans Pro is served as "Source Sans 3" by Google Fonts; keep both names in stacks. */
function fontStack(f: string): string {
  return f.replace(/"?Source Sans Pro"?/g, '"Source Sans 3", "Source Sans Pro"');
}

const VARS: [keyof Theme['colors'], string][] = [
  ['bg0', '--bg0'],
  ['bg1', '--bg1'],
  ['bg2', '--bg2'],
  ['bg3', '--bg3'],
  ['textHeadings', '--text-headings'],
  ['textMain', '--text-main'],
  ['textDisabled', '--text-disabled'],
  ['textPlaceholder', '--text-placeholder'],
  ['warning', '--warning'],
  ['textHighlight', '--text-highlight'],
  ['textPrompt', '--text-prompt'],
  ['textUser', '--text-user'],
  ['textEdit', '--text-edit'],
  ['textAI', '--text-ai'],
  ['lowIntensityColor', '--low-intensity'],
  ['midIntensityColor', '--mid-intensity'],
  ['highIntensityColor', '--high-intensity'],
];

/** Relative luminance of a #rrggbb color, used to pick light/dark color-scheme. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function applyTheme(theme: Theme, customCss = ''): void {
  const root = document.documentElement;
  for (const [key, cssVar] of VARS) {
    const v = theme.colors[key];
    if (typeof v === 'string') root.style.setProperty(cssVar, v);
  }
  root.style.setProperty('--font-default', fontStack(theme.fonts.default));
  root.style.setProperty('--font-field', fontStack(theme.fonts.field || theme.fonts.default));
  root.style.setProperty('--font-headings', fontStack(theme.fonts.headings) + ', serif');
  root.style.setProperty('--font-code', theme.fonts.code);
  root.style.colorScheme = luminance(theme.colors.bg2) > 0.4 ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.bg2);
  let style = document.getElementById('nw-custom-css') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'nw-custom-css';
    document.head.appendChild(style);
  }
  style.textContent = `${theme.global ?? ''}\n${customCss}`;
}
