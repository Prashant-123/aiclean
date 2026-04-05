/**
 * Package Managers
 * Verified cache paths for macOS and Linux.
 */

module.exports = [
  // ── npm ─────────────────────────────────────────────────────
  {
    id: 'npm',
    name: 'npm',
    category: 'Package Managers',
    risk: 'medium',
    riskReason: 'Package cache speeds up installs — clearing means re-downloading on next npm install',
    processNames: ['npm'],
    description: 'npm package cache, logs, and npx cache',
    paths: {
      darwin: [
        { name: 'package cache', path: '~/.npm/_cacache' },
        { name: 'install logs', path: '~/.npm/_logs' },
        { name: 'npx cache', path: '~/.npm/_npx' },
      ],
      linux: [
        { name: 'package cache', path: '~/.npm/_cacache' },
        { name: 'install logs', path: '~/.npm/_logs' },
        { name: 'npx cache', path: '~/.npm/_npx' },
      ],
    },
  },

  // ── Yarn ────────────────────────────────────────────────────
  {
    id: 'yarn',
    name: 'Yarn',
    category: 'Package Managers',
    risk: 'medium',
    riskReason: 'Offline mirror cache — re-downloaded from registry on next install',
    processNames: ['yarn'],
    description: 'Yarn v1 and Berry package caches',
    paths: {
      darwin: [
        { name: 'v1 cache', path: '~/Library/Caches/Yarn/v6' },
        { name: 'berry cache', path: '~/.yarn/berry/cache' },
      ],
      linux: [
        { name: 'v1 cache', path: '~/.cache/yarn/v6' },
        { name: 'berry cache', path: '~/.yarn/berry/cache' },
      ],
    },
  },

  // ── pnpm ────────────────────────────────────────────────────
  {
    id: 'pnpm',
    name: 'pnpm',
    category: 'Package Managers',
    risk: 'medium',
    riskReason: 'Content-addressable store — shared across projects, re-downloaded on next install',
    processNames: ['pnpm'],
    description: 'pnpm content-addressable store and cache',
    paths: {
      darwin: [
        { name: 'store', path: '~/Library/pnpm/store/v3' },
        { name: 'cache', path: '~/.cache/pnpm' },
        { name: 'store (alt)', path: '~/.local/share/pnpm/store/v3' },
      ],
      linux: [
        { name: 'store', path: '~/.local/share/pnpm/store/v3' },
        { name: 'cache', path: '~/.cache/pnpm' },
      ],
    },
  },

  // ── pip ─────────────────────────────────────────────────────
  {
    id: 'pip',
    name: 'pip',
    category: 'Package Managers',
    risk: 'low',
    riskReason: 'Wheel and HTTP caches — pip re-downloads as needed',
    processNames: ['pip', 'pip3'],
    description: 'pip wheel and HTTP download caches',
    paths: {
      darwin: [
        { name: 'wheel cache', path: '~/Library/Caches/pip/wheels' },
        { name: 'HTTP cache', path: '~/Library/Caches/pip/http' },
        { name: 'HTTP v2 cache', path: '~/Library/Caches/pip/http-v2' },
        { name: 'selfcheck', path: '~/Library/Caches/pip/selfcheck' },
      ],
      linux: [
        { name: 'wheel cache', path: '~/.cache/pip/wheels' },
        { name: 'HTTP cache', path: '~/.cache/pip/http' },
        { name: 'HTTP v2 cache', path: '~/.cache/pip/http-v2' },
        { name: 'selfcheck', path: '~/.cache/pip/selfcheck' },
      ],
    },
  },

  // ── Conda ───────────────────────────────────────────────────
  {
    id: 'conda',
    name: 'Conda',
    category: 'Package Managers',
    risk: 'high',
    riskReason: 'Package tarballs can be 5-20 GB and very slow to re-download; may break environments if cleaned while in use',
    processNames: ['conda', 'mamba'],
    description: 'Conda downloaded package tarballs',
    paths: {
      darwin: [
        { name: 'package tarballs', path: '~/miniconda3/pkgs' },
        { name: 'anaconda pkgs', path: '~/anaconda3/pkgs' },
        { name: 'miniforge pkgs', path: '~/miniforge3/pkgs' },
        { name: 'mambaforge pkgs', path: '~/mambaforge/pkgs' },
      ],
      linux: [
        { name: 'package tarballs', path: '~/miniconda3/pkgs' },
        { name: 'anaconda pkgs', path: '~/anaconda3/pkgs' },
        { name: 'miniforge pkgs', path: '~/miniforge3/pkgs' },
        { name: 'mambaforge pkgs', path: '~/mambaforge/pkgs' },
      ],
    },
  },

  // ── Poetry ──────────────────────────────────────────────────
  {
    id: 'poetry',
    name: 'Poetry',
    category: 'Package Managers',
    risk: 'low',
    riskReason: 'Download artifacts cache — re-fetched from PyPI on next install',
    processNames: ['poetry'],
    description: 'Poetry package download and metadata caches',
    paths: {
      darwin: [
        { name: 'artifacts', path: '~/Library/Caches/pypoetry/artifacts' },
        { name: 'cache', path: '~/Library/Caches/pypoetry/cache' },
      ],
      linux: [
        { name: 'artifacts', path: '~/.cache/pypoetry/artifacts' },
        { name: 'cache', path: '~/.cache/pypoetry/cache' },
      ],
    },
  },

  // ── Pipenv ──────────────────────────────────────────────────
  {
    id: 'pipenv',
    name: 'Pipenv',
    category: 'Package Managers',
    risk: 'low',
    riskReason: 'HTTP cache — re-downloaded on next install',
    processNames: ['pipenv'],
    description: 'Pipenv HTTP cache and managed virtualenvs',
    paths: {
      darwin: [
        { name: 'cache', path: '~/Library/Caches/pipenv' },
      ],
      linux: [
        { name: 'cache', path: '~/.cache/pipenv' },
      ],
    },
  },

  // ── Homebrew ────────────────────────────────────────────────
  {
    id: 'homebrew',
    name: 'Homebrew',
    category: 'Package Managers',
    risk: 'low',
    riskReason: 'Downloaded bottles and casks — re-downloaded by brew on next install',
    processNames: ['brew'],
    description: 'Homebrew downloaded bottles, casks, and API cache',
    paths: {
      darwin: [
        { name: 'downloads', path: '~/Library/Caches/Homebrew/downloads' },
        { name: 'cask downloads', path: '~/Library/Caches/Homebrew/Cask' },
        { name: 'API cache', path: '~/Library/Caches/Homebrew/api' },
      ],
      linux: [
        { name: 'cache', path: '~/.cache/Homebrew' },
      ],
    },
  },

  // ── CocoaPods ───────────────────────────────────────────────
  {
    id: 'cocoapods',
    name: 'CocoaPods',
    category: 'Package Managers',
    risk: 'medium',
    riskReason: 'Pod specs cache — re-cloned from CDN but can take a few minutes',
    processNames: ['pod'],
    description: 'CocoaPods downloaded pod specs and source cache',
    paths: {
      darwin: [
        { name: 'cache', path: '~/Library/Caches/CocoaPods' },
      ],
      linux: [],
    },
  },

  // ── Ruby Gems / Bundler ─────────────────────────────────────
  {
    id: 'rubygems',
    name: 'Ruby Gems',
    category: 'Package Managers',
    risk: 'low',
    riskReason: 'Bundler download cache — re-fetched from rubygems.org',
    processNames: ['bundle', 'gem'],
    description: 'Ruby gem download cache and Bundler cache',
    paths: {
      darwin: [
        { name: 'bundler cache', path: '~/.bundle/cache' },
      ],
      linux: [
        { name: 'bundler cache', path: '~/.bundle/cache' },
      ],
    },
  },
];
