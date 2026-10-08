import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZE, MIN_SIZE, isAppUrl, isExternalHttpUrl, menuPoint, parseJsonObject, restoreBounds } from '../src/util.ts';

describe('desktop link handling', () => {
  it('only hands http(s) URLs to the system browser', () => {
    expect(isExternalHttpUrl('https://claude.ai/oauth/authorize?x=1')).toBe(true);
    expect(isExternalHttpUrl('http://localhost:1455/auth/callback')).toBe(true);
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'ms-settings:', 'not a url', '']) {
      expect(isExternalHttpUrl(bad)).toBe(false);
    }
  });

  it('recognises the app origin exactly', () => {
    const origin = 'http://127.0.0.1:41234';
    expect(isAppUrl('http://127.0.0.1:41234/story/abc', origin)).toBe(true);
    expect(isAppUrl('http://127.0.0.1:41235/', origin)).toBe(false);
    expect(isAppUrl('http://localhost:41234/', origin)).toBe(false);
    expect(isAppUrl('https://127.0.0.1:41234/', origin)).toBe(false);
    expect(isAppUrl('garbage', origin)).toBe(false);
  });
});

describe('window state', () => {
  const screen = [{ x: 0, y: 0, width: 1920, height: 1080 }];

  it('uses defaults without saved state', () => {
    expect(restoreBounds(undefined, screen)).toEqual(DEFAULT_SIZE);
    expect(restoreBounds({ bounds: { x: Number.NaN, y: 0, width: 1, height: 1 } }, screen)).toEqual(DEFAULT_SIZE);
  });

  it('keeps visible bounds and enforces the minimum size', () => {
    expect(restoreBounds({ bounds: { x: 100, y: 50, width: 1200, height: 800 } }, screen)).toEqual({ x: 100, y: 50, width: 1200, height: 800 });
    expect(restoreBounds({ bounds: { x: 10, y: 10, width: 100, height: 100 } }, screen)).toEqual({ x: 10, y: 10, ...MIN_SIZE });
  });

  it('drops the position when the window would be off-screen (display removed)', () => {
    expect(restoreBounds({ bounds: { x: 2500, y: 100, width: 1000, height: 700 } }, screen)).toEqual({ width: 1000, height: 700 });
    expect(restoreBounds({ bounds: { x: 100, y: -600, width: 1000, height: 700 } }, screen)).toEqual({ width: 1000, height: 700 });
  });

  it('tolerates corrupt state files', () => {
    expect(parseJsonObject('{"port": 1234}')).toEqual({ port: 1234 });
    expect(parseJsonObject('{oops')).toEqual({});
    expect(parseJsonObject('[1,2]')).toEqual({});
    expect(parseJsonObject(undefined)).toEqual({});
  });
});

describe('title bar menu', () => {
  it('keeps the menu position sent by the page inside the window', () => {
    expect(menuPoint(12.4, 38, 1200, 800)).toEqual({ x: 12, y: 38 });
    expect(menuPoint(-5, 9000, 1200, 800)).toEqual({ x: 0, y: 800 });
    expect(menuPoint('10', Number.NaN, 1200, 800)).toEqual({ x: 0, y: 0 });
  });
});
