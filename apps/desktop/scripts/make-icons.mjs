// Renders build/icon.svg to the PNG / ICO / ICNS icons electron-builder uses.
// The outputs are committed, so this only needs to run after changing the SVG:
//   CHROMIUM_PATH=/path/to/chromium node apps/desktop/scripts/make-icons.mjs
// ICO and ICNS files simply wrap PNG images (supported since Windows Vista / macOS 10.7).
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../build/', import.meta.url));
const svg = readFileSync(`${dir}icon.svg`, 'utf8');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
const render = async (size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
const png = {};
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) png[size] = await render(size);
await browser.close();

writeFileSync(`${dir}icon.png`, png[1024]);

// ICO: header, one directory entry per image, then the PNG payloads.
const icoSizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s === 256 ? 0 : s, e);
  header.writeUInt8(s === 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(png[s].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
writeFileSync(`${dir}icon.ico`, Buffer.concat([header, ...icoSizes.map((s) => png[s])]));

// ICNS: 'icns' + total length, then typed PNG chunks.
const icnsTypes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const chunks = icnsTypes.map(([type, s]) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(8 + png[s].length, 4);
  return Buffer.concat([head, png[s]]);
});
const body = Buffer.concat(chunks);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(8 + body.length, 4);
writeFileSync(`${dir}icon.icns`, Buffer.concat([icnsHead, body]));

