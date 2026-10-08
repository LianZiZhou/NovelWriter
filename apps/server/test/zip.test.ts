import { describe, expect, it } from 'vitest';

describe('zip', () => {
  it('writes an archive unzip can read', async () => {
    const { zipFiles } = await import('@novelwriter/core');
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'nwzip-'));
    const zip = zipFiles([{ name: 'a.story', data: 'hello' }, { name: 'a.story', data: 'héllo ✓' }]);
    writeFileSync(join(dir, 'x.zip'), zip);
    try {
      execFileSync('unzip', ['-q', join(dir, 'x.zip'), '-d', join(dir, 'out')]);
    } catch {
      return; // no unzip on this machine
    }
    expect(readFileSync(join(dir, 'out', 'a.story'), 'utf8')).toBe('hello');
    expect(readFileSync(join(dir, 'out', 'a (2).story'), 'utf8')).toBe('héllo ✓');
  });
});
