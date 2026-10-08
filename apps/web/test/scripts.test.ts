import { describe, expect, it } from 'vitest';
import { configValues, parseMeta, safeStyle } from '../src/features/scripts/meta.ts';
import { EXAMPLES } from '../src/features/scripts/examples.ts';

describe('script metadata', () => {
  it('reads the @meta block, keeping only known permissions', () => {
    const { meta, error } = parseMeta(`/*@meta
{ "name": "X", "permissions": ["documentEdit", "rootAccess"], "config": [{ "id": "n", "type": "number", "label": "N", "default": 3 }, { "id": "b", "type": "boolean", "label": "B" }] }
*/
api.v1.log(1);`);
    expect(error).toBeUndefined();
    expect(meta.name).toBe('X');
    expect(meta.permissions).toEqual(['documentEdit']);
    expect(configValues(meta, { b: true })).toEqual({ n: 3, b: true });
  });

  it('reports a broken @meta block and still runs without it', () => {
    const r = parseMeta('/*@meta { nope } */');
    expect(r.error).toMatch(/@meta/);
    expect(r.meta.permissions).toEqual([]);
  });

  it('every example has a valid @meta block or none', () => {
    for (const ex of EXAMPLES) expect(parseMeta(ex.code).error, ex.name).toBeUndefined();
  });
});

describe('decoration styles', () => {
  it('keeps safe properties and drops the rest', () => {
    expect(safeStyle({ color: 'red', backgroundColor: '#222', position: 'fixed', background: 'url(http://x)', fontWeight: 'bold; display:none' })).toBe('color: red; background-color: #222');
  });
});
