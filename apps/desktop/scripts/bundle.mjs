// Bundles the Electron main process together with the NovelWriter server
// (apps/server, packages/core and their npm dependencies) into dist/main.mjs.
import { build } from 'esbuild';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(`${root}dist`, { recursive: true, force: true });

if (!existsSync(`${root}../web/dist/index.html`)) {
  console.warn('warning: apps/web/dist is missing; run `npm run build` first or the window will be blank.');
}

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Electron is provided by the runtime. ws optionally uses these native addons and
  // falls back to JavaScript when they are missing.
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  // Bundled CommonJS packages (fastify and friends) call require() and use
  // __dirname / __filename, which do not exist in an ES module.
  banner: {
    js: [
      "import { createRequire as __nwCreateRequire } from 'node:module';",
      "import { fileURLToPath as __nwFileURLToPath } from 'node:url';",
      "import { dirname as __nwDirname } from 'node:path';",
      'const require = __nwCreateRequire(import.meta.url);',
      'const __filename = __nwFileURLToPath(import.meta.url);',
      'const __dirname = __nwDirname(__filename);',
    ].join('\n'),
  },
  sourcemap: 'linked',
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'linked',
  metafile: true,
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`bundled dist/main.mjs (${(bytes / 1024 / 1024).toFixed(1)} MB incl. source map)`);
