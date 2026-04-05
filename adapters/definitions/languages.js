/**
 * Programming Language Caches
 * Verified cache paths for macOS and Linux.
 */

module.exports = [
  // ── Cargo (Rust) ────────────────────────────────────────────
  {
    id: 'cargo',
    name: 'Cargo (Rust)',
    category: 'Languages',
    risk: 'medium',
    riskReason: 'Registry cache and git deps — re-downloaded from crates.io, but can be several GB and slow on large projects',
    processNames: ['cargo', 'rustc'],
    description: 'Rust Cargo registry cache, source, and git dependencies',
    paths: {
      darwin: [
        { name: 'registry cache', path: '~/.cargo/registry/cache' },
        { name: 'registry src', path: '~/.cargo/registry/src' },
        { name: 'git db', path: '~/.cargo/git/db' },
        { name: 'git checkouts', path: '~/.cargo/git/checkouts' },
      ],
      linux: [
        { name: 'registry cache', path: '~/.cargo/registry/cache' },
        { name: 'registry src', path: '~/.cargo/registry/src' },
        { name: 'git db', path: '~/.cargo/git/db' },
        { name: 'git checkouts', path: '~/.cargo/git/checkouts' },
      ],
    },
  },

  // ── Go ──────────────────────────────────────────────────────
  {
    id: 'go',
    name: 'Go',
    category: 'Languages',
    risk: 'medium',
    riskReason: 'Module cache shared across all Go projects — re-downloaded but can slow builds',
    processNames: ['go'],
    description: 'Go module cache and build cache',
    paths: {
      darwin: [
        { name: 'module cache', path: '~/go/pkg/mod' },
        { name: 'build cache', path: '~/Library/Caches/go-build' },
      ],
      linux: [
        { name: 'module cache', path: '~/go/pkg/mod' },
        { name: 'build cache', path: '~/.cache/go-build' },
      ],
    },
  },

  // ── Gradle (Java/Kotlin) ───────────────────────────────────
  {
    id: 'gradle',
    name: 'Gradle',
    category: 'Languages',
    risk: 'high',
    riskReason: 'Dependency cache can be 10-30 GB; first build after cleaning takes 10-60 min downloading all dependencies',
    processNames: ['gradle', 'gradlew', 'java'],
    description: 'Gradle dependency cache, wrapper distributions, and daemon logs',
    paths: {
      darwin: [
        { name: 'dependency cache', path: '~/.gradle/caches' },
        { name: 'wrapper dists', path: '~/.gradle/wrapper/dists' },
        { name: 'temp files', path: '~/.gradle/.tmp' },
        { name: 'daemon logs', path: '~/.gradle/daemon' },
        { name: 'build scan data', path: '~/.gradle/build-scan-data' },
        { name: 'notifications', path: '~/.gradle/notifications' },
      ],
      linux: [
        { name: 'dependency cache', path: '~/.gradle/caches' },
        { name: 'wrapper dists', path: '~/.gradle/wrapper/dists' },
        { name: 'temp files', path: '~/.gradle/.tmp' },
        { name: 'daemon logs', path: '~/.gradle/daemon' },
        { name: 'build scan data', path: '~/.gradle/build-scan-data' },
        { name: 'notifications', path: '~/.gradle/notifications' },
      ],
    },
  },

  // ── Maven (Java) ────────────────────────────────────────────
  {
    id: 'maven',
    name: 'Maven',
    category: 'Languages',
    risk: 'high',
    riskReason: 'Local repository is the dependency cache for all Maven projects — rebuilding can take 30+ minutes',
    processNames: ['mvn', 'mvnw'],
    description: 'Maven local repository (downloaded dependencies)',
    paths: {
      darwin: [
        { name: 'local repository', path: '~/.m2/repository' },
      ],
      linux: [
        { name: 'local repository', path: '~/.m2/repository' },
      ],
    },
  },

  // ── Python caches ──────────────────────────────────────────
  {
    id: 'python',
    name: 'Python',
    category: 'Languages',
    risk: 'low',
    riskReason: 'Ruff linter cache — rebuilt instantly on next lint run',
    processNames: [],
    description: 'Python bytecode caches, mypy, pytest, and ruff caches',
    paths: {
      darwin: [
        { name: 'ruff cache', path: '~/Library/Caches/ruff' },
      ],
      linux: [
        { name: 'ruff cache', path: '~/.cache/ruff' },
      ],
    },
  },
];
