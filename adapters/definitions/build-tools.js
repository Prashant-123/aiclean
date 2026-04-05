/**
 * Build Tools & Bundlers
 * Verified cache paths for macOS and Linux.
 */

module.exports = [
  // ── Docker ──────────────────────────────────────────────────
  {
    id: 'docker',
    name: 'Docker',
    category: 'Build Tools',
    risk: 'medium',
    riskReason: 'Buildx cache metadata — next build will be slower without layer cache',
    processNames: ['docker', 'dockerd', 'Docker Desktop'],
    description: 'Docker buildx cache and metadata',
    paths: {
      darwin: [
        { name: 'buildx cache', path: '~/.docker/buildx' },
      ],
      linux: [
        { name: 'buildx cache', path: '~/.docker/buildx' },
      ],
    },
  },

  // ── Turborepo ───────────────────────────────────────────────
  {
    id: 'turborepo',
    name: 'Turborepo',
    category: 'Build Tools',
    risk: 'low',
    riskReason: 'Build output cache — turbo just rebuilds without cache hits',
    processNames: ['turbo'],
    description: 'Turborepo global build cache',
    paths: {
      darwin: [
        { name: 'global cache', path: '~/Library/Caches/turborepo' },
      ],
      linux: [
        { name: 'global cache', path: '~/.cache/turborepo' },
      ],
    },
  },

  // ── Watchman ────────────────────────────────────────────────
  {
    id: 'watchman',
    name: 'Watchman',
    category: 'Build Tools',
    risk: 'low',
    riskReason: 'File watching state — rebuilt when watchman restarts',
    processNames: ['watchman'],
    description: 'Facebook Watchman file watching state',
    paths: {
      darwin: [
        { name: 'state', path: '/opt/homebrew/var/run/watchman' },
        { name: 'state (intel)', path: '/usr/local/var/run/watchman' },
      ],
      linux: [
        { name: 'state', path: '/tmp/watchman-${USER}' },
      ],
    },
  },

  // ── Metro Bundler (React Native) ────────────────────────────
  {
    id: 'metro',
    name: 'Metro Bundler',
    category: 'Build Tools',
    risk: 'low',
    riskReason: 'Bundler cache in /tmp — rebuilt on next metro start',
    processNames: ['metro'],
    description: 'React Native Metro bundler and haste map caches',
    paths: {
      darwin: [
        { name: 'metro cache', path: '/tmp/metro-cache' },
        { name: 'haste map', path: '/tmp/haste-map-metro' },
      ],
      linux: [
        { name: 'metro cache', path: '/tmp/metro-cache' },
        { name: 'haste map', path: '/tmp/haste-map-metro' },
      ],
    },
  },
];
