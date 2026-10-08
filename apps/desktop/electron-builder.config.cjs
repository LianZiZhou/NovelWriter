// electron-builder configuration for the NovelWriter desktop app.
// Build installers for the current OS with `npm run desktop:dist` from the repo root.
//
// Code signing is optional:
//  - macOS: without CSC_LINK / CSC_NAME the app is ad-hoc signed (identity "-"), which is
//    enough for Apple Silicon to run it once Gatekeeper is told to allow it. With a
//    certificate it is signed with the hardened runtime, and notarized when
//    APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID (or APPLE_API_KEY*) are set.
//  - Windows: signed when WIN_CSC_LINK (+ WIN_CSC_KEY_PASSWORD) is set, unsigned otherwise.
// See .github/workflows/desktop.yml for the matching CI secrets.

const env = process.env;
// CI passes the release tag (v1.2.3 -> 1.2.3) so installers carry the released version.
const version = env.NOVELWRITER_VERSION?.replace(/^v/, '') || undefined;
const macSigning = Boolean(env.CSC_LINK || env.CSC_NAME);
const macNotarize = macSigning && Boolean((env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) || env.APPLE_API_KEY);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.lianzizhou.novelwriter',
  productName: 'NovelWriter',
  copyright: 'Copyright © LianZiZhou and contributors',
  directories: { output: 'release', buildResources: 'build' },
  // Everything the app runs is bundled into dist/main.mjs (see scripts/bundle.mjs).
  files: ['package.json', 'dist/main.mjs', 'dist/main.mjs.LEGAL.txt', 'dist/preload.cjs'],
  extraResources: [
    { from: '../web/dist', to: 'web' },
    { from: 'build/icon.png', to: 'icon.png' },
  ],
  extraMetadata: version ? { version } : undefined,
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  publish: null,

  win: {
    icon: 'build/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  },
  portable: {
    artifactName: '${productName}-Portable-${version}-${arch}.${ext}',
  },

  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.productivity',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    identity: macSigning ? undefined : '-',
    hardenedRuntime: macSigning,
    notarize: macNotarize ? undefined : false,
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  },
  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },

  linux: {
    executableName: 'novelwriter',
    syncDesktopName: true,
    icon: 'build/icon.png',
    category: 'Office',
    synopsis: 'AI writing studio',
    description: 'NovelWriter: an AI writing studio with a NovelAI-style story editor.',
    maintainer: 'LianZiZhou <noreply@github.com>',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  deb: {
    artifactName: 'novelwriter_${version}_${arch}.${ext}',
  },
};
