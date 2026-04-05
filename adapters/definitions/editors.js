/**
 * Code Editors & IDEs
 * Verified cache paths for macOS and Linux.
 */
const { getAllJetBrainsCacheDirs, getAllJetBrainsLogDirs } = require('../../utils/platform');

module.exports = [
  // ── VS Code ─────────────────────────────────────────────────
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'Editors',
    risk: 'low',
    riskReason: 'Caches and logs — VS Code rebuilds them on restart',
    processNames: ['code', 'Code', 'Electron'],
    description: 'Visual Studio Code caches, logs, and cached extensions',
    paths: {
      darwin: [
        { name: 'app cache', path: '~/Library/Application Support/Code/Cache' },
        { name: 'cached data', path: '~/Library/Application Support/Code/CachedData' },
        { name: 'cached extensions', path: '~/Library/Application Support/Code/CachedExtensionVSIXs' },
        { name: 'cached configs', path: '~/Library/Application Support/Code/CachedConfigurations' },
        { name: 'cached profiles', path: '~/Library/Application Support/Code/CachedProfilesData' },
        { name: 'code cache', path: '~/Library/Application Support/Code/Code Cache' },
        { name: 'blob storage', path: '~/Library/Application Support/Code/blob_storage' },
        { name: 'logs', path: '~/Library/Application Support/Code/logs' },
        { name: 'GPU cache', path: '~/Library/Application Support/Code/GPUCache' },
        { name: 'system cache', path: '~/Library/Caches/com.microsoft.VSCode' },
        { name: 'updater cache', path: '~/Library/Caches/com.microsoft.VSCode.ShipIt' },
      ],
      linux: [
        { name: 'app cache', path: '~/.config/Code/Cache' },
        { name: 'cached data', path: '~/.config/Code/CachedData' },
        { name: 'cached extensions', path: '~/.config/Code/CachedExtensionVSIXs' },
        { name: 'code cache', path: '~/.config/Code/Code Cache' },
        { name: 'blob storage', path: '~/.config/Code/blob_storage' },
        { name: 'logs', path: '~/.config/Code/logs' },
      ],
    },
  },

  // ── JetBrains IDEs ──────────────────────────────────────────
  {
    id: 'jetbrains',
    name: 'JetBrains IDEs',
    category: 'Editors',
    risk: 'medium',
    riskReason: 'Index and cache rebuilds can take several minutes on large projects',
    processNames: ['idea', 'pycharm', 'webstorm', 'phpstorm', 'goland', 'clion', 'datagrip', 'rider', 'rubymine', 'studio'],
    description: 'IntelliJ, PyCharm, WebStorm, GoLand, and other JetBrains caches and logs',
    paths: {
      darwin: [],
      linux: [],
    },
    async dynamicPaths() {
      const cacheDirs = await getAllJetBrainsCacheDirs();
      const logDirs = await getAllJetBrainsLogDirs();
      const results = [];
      for (const dir of cacheDirs) {
        const name = dir.split('/').pop();
        results.push({ name: `${name} cache`, path: dir });
      }
      for (const dir of logDirs) {
        const name = dir.split('/').pop();
        results.push({ name: `${name} logs`, path: dir });
      }
      return results;
    },
  },

  // ── Zed Editor ──────────────────────────────────────────────
  {
    id: 'zed',
    name: 'Zed',
    category: 'Editors',
    risk: 'low',
    riskReason: 'Logs and language server caches — re-downloaded on next use',
    processNames: ['zed', 'Zed'],
    description: 'Zed editor logs, embeddings, and language server caches',
    paths: {
      darwin: [
        { name: 'logs', path: '~/Library/Application Support/Zed/logs' },
        { name: 'embeddings', path: '~/Library/Application Support/Zed/embeddings' },
        { name: 'copilot cache', path: '~/Library/Application Support/Zed/copilot' },
        { name: 'languages', path: '~/Library/Application Support/Zed/languages' },
        { name: 'system cache', path: '~/Library/Caches/dev.zed.Zed' },
      ],
      linux: [
        { name: 'logs', path: '~/.local/share/zed/logs' },
        { name: 'embeddings', path: '~/.local/share/zed/embeddings' },
        { name: 'languages', path: '~/.local/share/zed/languages' },
        { name: 'system cache', path: '~/.cache/zed' },
      ],
    },
  },

  // ── Xcode ───────────────────────────────────────────────────
  {
    id: 'xcode',
    name: 'Xcode',
    category: 'Editors',
    risk: 'high',
    riskReason: 'DerivedData can be 5-20 GB and takes 10-30 min to rebuild; Archives may contain App Store submissions',
    processNames: ['Xcode', 'xcodebuild'],
    description: 'Xcode derived data, module cache, and simulator caches',
    paths: {
      darwin: [
        { name: 'derived data', path: '~/Library/Developer/Xcode/DerivedData' },
        { name: 'simulator caches', path: '~/Library/Developer/CoreSimulator/Caches' },
        { name: 'archives', path: '~/Library/Developer/Xcode/Archives' },
      ],
      linux: [],
    },
  },

  // ── Android Studio ──────────────────────────────────────────
  {
    id: 'android-studio',
    name: 'Android Studio',
    category: 'Editors',
    risk: 'high',
    riskReason: 'AVD images are 2-8 GB each and take 30+ min to download; build cache speeds up builds significantly',
    processNames: ['studio', 'Android Studio', 'qemu-system'],
    description: 'Android Studio caches, AVD, and build outputs',
    paths: {
      darwin: [
        { name: 'system cache', path: '~/Library/Caches/Google/AndroidStudio*' },
        { name: 'AVD images', path: '~/.android/avd' },
        { name: 'gradle build cache', path: '~/.android/build-cache' },
        { name: 'debug keystore', path: '~/.android/cache' },
      ],
      linux: [
        { name: 'system cache', path: '~/.cache/Google/AndroidStudio*' },
        { name: 'AVD images', path: '~/.android/avd' },
        { name: 'build cache', path: '~/.android/build-cache' },
        { name: 'cache', path: '~/.android/cache' },
      ],
    },
  },

  // ── Sublime Text ────────────────────────────────────────────
  {
    id: 'sublime',
    name: 'Sublime Text',
    category: 'Editors',
    risk: 'low',
    riskReason: 'Index and cache files — rebuilt on launch',
    processNames: ['sublime_text', 'Sublime Text'],
    description: 'Sublime Text caches and index',
    paths: {
      darwin: [
        { name: 'cache', path: '~/Library/Caches/com.sublimetext.4' },
        { name: 'index', path: '~/Library/Application Support/Sublime Text/Index' },
        { name: 'cache files', path: '~/Library/Application Support/Sublime Text/Cache' },
      ],
      linux: [
        { name: 'cache', path: '~/.cache/sublime-text' },
        { name: 'index', path: '~/.config/sublime-text/Index' },
        { name: 'cache files', path: '~/.config/sublime-text/Cache' },
      ],
    },
  },
];
