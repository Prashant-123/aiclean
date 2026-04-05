/**
 * System Caches, Temp Files, Browsers, and Trash
 * Verified cache paths for macOS and Linux.
 */

module.exports = [
  // ── System Temp ─────────────────────────────────────────────
  {
    id: 'temp',
    name: 'System Temp',
    category: 'System',
    risk: 'medium',
    riskReason: 'May contain temp files from running applications — cleaning while apps are open can cause issues',
    processNames: [],
    description: 'System temporary file directories',
    paths: {
      darwin: [
        { name: '/tmp', path: '/tmp' },
        { name: '/var/tmp', path: '/private/var/tmp' },
      ],
      linux: [
        { name: '/tmp', path: '/tmp' },
        { name: '/var/tmp', path: '/var/tmp' },
      ],
    },
  },

  // ── Trash ───────────────────────────────────────────────────
  {
    id: 'trash',
    name: 'Trash',
    category: 'System',
    risk: 'high',
    riskReason: 'Permanently deletes files in Trash — this action is IRREVERSIBLE',
    processNames: [],
    description: 'User trash / recycle bin',
    paths: {
      darwin: [
        { name: 'user trash', path: '~/.Trash' },
      ],
      linux: [
        { name: 'trash files', path: '~/.local/share/Trash/files' },
        { name: 'trash info', path: '~/.local/share/Trash/info' },
      ],
    },
  },

  // ── Chrome ──────────────────────────────────────────────────
  {
    id: 'chrome',
    name: 'Google Chrome',
    category: 'System',
    risk: 'low',
    riskReason: 'Browser caches — Chrome rebuilds them automatically',
    processNames: ['Google Chrome', 'chrome'],
    description: 'Chrome browser HTTP, code, GPU, and service worker caches',
    paths: {
      darwin: [
        { name: 'HTTP cache', path: '~/Library/Caches/Google/Chrome/Default/Cache' },
        { name: 'code cache', path: '~/Library/Caches/Google/Chrome/Default/Code Cache' },
        { name: 'GPU cache', path: '~/Library/Application Support/Google/Chrome/Default/GPUCache' },
        { name: 'Dawn cache', path: '~/Library/Application Support/Google/Chrome/Default/DawnGraphiteCache' },
        { name: 'WebGPU cache', path: '~/Library/Application Support/Google/Chrome/Default/DawnWebGPUCache' },
        { name: 'blob storage', path: '~/Library/Application Support/Google/Chrome/Default/blob_storage' },
        { name: 'service workers', path: '~/Library/Application Support/Google/Chrome/Default/Service Worker' },
      ],
      linux: [
        { name: 'HTTP cache', path: '~/.cache/google-chrome/Default/Cache' },
        { name: 'code cache', path: '~/.cache/google-chrome/Default/Code Cache' },
        { name: 'GPU cache', path: '~/.config/google-chrome/Default/GPUCache' },
        { name: 'blob storage', path: '~/.config/google-chrome/Default/blob_storage' },
        { name: 'service workers', path: '~/.config/google-chrome/Default/Service Worker' },
      ],
    },
  },

  // ── Firefox ─────────────────────────────────────────────────
  {
    id: 'firefox',
    name: 'Firefox',
    category: 'System',
    risk: 'low',
    riskReason: 'Browser cache — rebuilt on next browsing session',
    processNames: ['firefox', 'Firefox'],
    description: 'Firefox browser cache',
    paths: {
      darwin: [
        { name: 'cache', path: '~/Library/Caches/Firefox' },
      ],
      linux: [
        { name: 'cache', path: '~/.cache/mozilla/firefox' },
      ],
    },
  },

  // ── Safari ──────────────────────────────────────────────────
  {
    id: 'safari',
    name: 'Safari',
    category: 'System',
    risk: 'low',
    riskReason: 'Browser caches — rebuilt automatically',
    processNames: ['Safari'],
    description: 'Safari browser caches',
    paths: {
      darwin: [
        { name: 'cache', path: '~/Library/Caches/com.apple.Safari' },
        { name: 'webkit cache', path: '~/Library/Caches/com.apple.WebKit.WebContent' },
      ],
      linux: [],
    },
  },

  // ── macOS System Logs ───────────────────────────────────────
  {
    id: 'system-logs',
    name: 'System Logs',
    category: 'System',
    risk: 'medium',
    riskReason: 'Application logs may be needed for debugging — consider keeping recent logs',
    processNames: [],
    description: 'User-level application log files',
    paths: {
      darwin: [
        { name: 'user logs', path: '~/Library/Logs' },
      ],
      linux: [
        { name: 'user logs', path: '~/.local/share/logs' },
      ],
    },
  },
];
