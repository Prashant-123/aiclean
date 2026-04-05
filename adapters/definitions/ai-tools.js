/**
 * AI Code Assistants & Tools
 * Verified cache paths for macOS and Linux.
 *
 * Risk levels:
 *   low    — pure caches/logs, regenerated automatically
 *   medium — build caches or data that takes time to rebuild
 *   high   — models, large downloads, or data that is expensive to re-acquire
 */

module.exports = [
  // ── Claude Code ─────────────────────────────────────────────
  {
    id: 'claude',
    name: 'Claude Code',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'Only caches and logs — regenerated on next use',
    processNames: ['claude', 'Claude'],
    description: 'Anthropic Claude Code CLI and desktop app caches',
    paths: {
      darwin: [
        { name: 'CLI cache', path: '~/Library/Caches/claude-cli-nodejs' },
        { name: 'staging cache', path: '~/.cache/claude/staging' },
        { name: 'debug logs', path: '~/.claude/debug' },
        { name: 'backups', path: '~/.claude/backups' },
        { name: 'cache', path: '~/.claude/cache' },
        { name: 'desktop app cache', path: '~/Library/Application Support/Claude/Cache' },
        { name: 'desktop blob storage', path: '~/Library/Application Support/Claude/blob_storage' },
        { name: 'desktop code cache', path: '~/Library/Application Support/Claude/Code Cache' },
        { name: 'desktop GPU cache', path: '~/Library/Application Support/Claude/GPUCache' },
        { name: 'desktop logs', path: '~/Library/Application Support/Claude/logs' },
        { name: 'updater cache', path: '~/Library/Caches/com.anthropic.claudefordesktop' },
        { name: 'updater ShipIt', path: '~/Library/Caches/com.anthropic.claudefordesktop.ShipIt' },
      ],
      linux: [
        { name: 'cache', path: '~/.cache/claude' },
        { name: 'CLI cache', path: '~/.cache/claude-cli-nodejs' },
        { name: 'debug logs', path: '~/.claude/debug' },
        { name: 'backups', path: '~/.claude/backups' },
        { name: 'cache dir', path: '~/.claude/cache' },
      ],
    },
  },

  // ── Cursor IDE ──────────────────────────────────────────────
  {
    id: 'cursor',
    name: 'Cursor',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'Electron caches and logs — rebuilt on launch',
    processNames: ['Cursor', 'cursor'],
    description: 'Cursor IDE caches, logs, and cached extensions',
    paths: {
      darwin: [
        { name: 'app cache', path: '~/Library/Application Support/Cursor/Cache' },
        { name: 'cached data', path: '~/Library/Application Support/Cursor/CachedData' },
        { name: 'cached extensions', path: '~/Library/Application Support/Cursor/CachedExtensionVSIXs' },
        { name: 'cached configs', path: '~/Library/Application Support/Cursor/CachedConfigurations' },
        { name: 'cached profiles', path: '~/Library/Application Support/Cursor/CachedProfilesData' },
        { name: 'code cache', path: '~/Library/Application Support/Cursor/Code Cache' },
        { name: 'blob storage', path: '~/Library/Application Support/Cursor/blob_storage' },
        { name: 'logs', path: '~/Library/Application Support/Cursor/logs' },
        { name: 'GPU cache', path: '~/Library/Application Support/Cursor/GPUCache' },
        { name: 'service worker', path: '~/Library/Application Support/Cursor/Service Worker' },
        { name: 'backups', path: '~/Library/Application Support/Cursor/Backups' },
      ],
      linux: [
        { name: 'app cache', path: '~/.config/Cursor/Cache' },
        { name: 'cached data', path: '~/.config/Cursor/CachedData' },
        { name: 'cached extensions', path: '~/.config/Cursor/CachedExtensionVSIXs' },
        { name: 'code cache', path: '~/.config/Cursor/Code Cache' },
        { name: 'blob storage', path: '~/.config/Cursor/blob_storage' },
        { name: 'logs', path: '~/.config/Cursor/logs' },
      ],
    },
  },

  // ── GitHub Copilot ──────────────────────────────────────────
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    category: 'AI Tools',
    risk: 'medium',
    riskReason: 'Project context index — can be large and slow to rebuild',
    processNames: [],
    description: 'GitHub Copilot project context and chat caches',
    paths: {
      darwin: [
        { name: 'cache', path: '~/.cache/github-copilot' },
      ],
      linux: [
        { name: 'cache', path: '~/.cache/github-copilot' },
      ],
    },
  },

  // ── Windsurf (Codeium) ─────────────────────────────────────
  {
    id: 'windsurf',
    name: 'Windsurf (Codeium)',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'Electron caches — rebuilt on launch',
    processNames: ['Windsurf', 'windsurf'],
    description: 'Windsurf/Codeium editor caches and skill data',
    paths: {
      darwin: [
        { name: 'skill cache', path: '~/.codeium/windsurf/skills' },
        { name: 'app cache', path: '~/Library/Application Support/Windsurf/Cache' },
        { name: 'cached data', path: '~/Library/Application Support/Windsurf/CachedData' },
        { name: 'cached extensions', path: '~/Library/Application Support/Windsurf/CachedExtensionVSIXs' },
        { name: 'code cache', path: '~/Library/Application Support/Windsurf/Code Cache' },
        { name: 'logs', path: '~/Library/Application Support/Windsurf/logs' },
        { name: 'blob storage', path: '~/Library/Application Support/Windsurf/blob_storage' },
        { name: 'GPU cache', path: '~/Library/Application Support/Windsurf/GPUCache' },
      ],
      linux: [
        { name: 'codeium cache', path: '~/.codeium' },
        { name: 'app cache', path: '~/.config/Windsurf/Cache' },
        { name: 'cached data', path: '~/.config/Windsurf/CachedData' },
        { name: 'logs', path: '~/.config/Windsurf/logs' },
      ],
    },
  },

  // ── Aider ───────────────────────────────────────────────────
  {
    id: 'aider',
    name: 'Aider',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'Repo map and tags caches — rebuilt on next session',
    processNames: ['aider'],
    description: 'Aider AI pair programming caches',
    paths: {
      darwin: [
        { name: 'caches', path: '~/.aider/caches' },
        { name: 'tags cache', path: '~/.aider/tags.cache' },
        { name: 'XDG cache', path: '~/.cache/aider' },
      ],
      linux: [
        { name: 'caches', path: '~/.aider/caches' },
        { name: 'tags cache', path: '~/.aider/tags.cache' },
        { name: 'XDG cache', path: '~/.cache/aider' },
      ],
    },
  },

  // ── Continue.dev ────────────────────────────────────────────
  {
    id: 'continue',
    name: 'Continue.dev',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'Embeddings index and autocomplete cache — rebuilt automatically',
    processNames: [],
    description: 'Continue.dev autocomplete and embeddings caches',
    paths: {
      darwin: [
        { name: 'index/embeddings', path: '~/.continue/index' },
        { name: 'dev data', path: '~/.continue/dev_data' },
        { name: 'utils cache', path: '~/.continue/.utils' },
      ],
      linux: [
        { name: 'index/embeddings', path: '~/.continue/index' },
        { name: 'dev data', path: '~/.continue/dev_data' },
        { name: 'utils cache', path: '~/.continue/.utils' },
      ],
    },
  },

  // ── Cody (Sourcegraph) ─────────────────────────────────────
  {
    id: 'cody',
    name: 'Cody (Sourcegraph)',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'Embeddings cache — rebuilt on next indexing',
    processNames: [],
    description: 'Sourcegraph Cody embeddings cache',
    paths: {
      darwin: [
        { name: 'embeddings', path: '~/.sourcegraph/cody' },
      ],
      linux: [
        { name: 'embeddings', path: '~/.sourcegraph/cody' },
      ],
    },
  },

  // ── Tabnine ─────────────────────────────────────────────────
  {
    id: 'tabnine',
    name: 'Tabnine',
    category: 'AI Tools',
    risk: 'medium',
    riskReason: 'Includes ML models that are re-downloaded (~500 MB)',
    processNames: ['TabNine'],
    description: 'Tabnine AI models, logs, and caches',
    paths: {
      darwin: [
        { name: 'models', path: '~/.tabnine/models' },
        { name: 'logs', path: '~/.tabnine/logs' },
        { name: 'cache', path: '~/.tabnine/cache' },
        { name: 'system cache', path: '~/Library/Caches/TabNine' },
      ],
      linux: [
        { name: 'models', path: '~/.tabnine/models' },
        { name: 'logs', path: '~/.tabnine/logs' },
        { name: 'cache', path: '~/.tabnine/cache' },
        { name: 'system cache', path: '~/.cache/TabNine' },
      ],
    },
  },

  // ── Amazon Q / CodeWhisperer ────────────────────────────────
  {
    id: 'amazon-q',
    name: 'Amazon Q',
    category: 'AI Tools',
    risk: 'low',
    riskReason: 'App and system caches — regenerated on use',
    processNames: ['amazon-q'],
    description: 'Amazon Q / CodeWhisperer caches',
    paths: {
      darwin: [
        { name: 'app cache', path: '~/Library/Application Support/amazon-q' },
        { name: 'system cache', path: '~/Library/Caches/amazon-q' },
      ],
      linux: [
        { name: 'config cache', path: '~/.config/amazon-q' },
        { name: 'system cache', path: '~/.cache/amazon-q' },
      ],
    },
  },
];
