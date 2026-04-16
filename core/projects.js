/**
 * Project-aware cleaning (Pro feature).
 *
 * Walks common developer directories, finds project build artifacts
 * (node_modules, target, .venv, etc.), groups them by their enclosing
 * git repo, and lets the user reclaim from DORMANT projects (no git
 * activity in N days) without touching active ones.
 *
 * This is "npkill, but smarter and across ecosystems".
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getDirSize, formatSize, parseDuration } = require('../utils/size');

const DEFAULT_ROOTS = [
  path.join(os.homedir(), 'Projects'),
  path.join(os.homedir(), 'Code'),
  path.join(os.homedir(), 'dev'),
  path.join(os.homedir(), 'Development'),
  path.join(os.homedir(), 'workspace'),
  path.join(os.homedir(), 'src'),
  path.join(os.homedir(), 'repos'),
  path.join(os.homedir(), 'git'),
];

/**
 * Per-ecosystem artifact patterns. Each entry:
 *   name  — user-facing label
 *   match — directory name to look for
 *   risk  — low | medium (how much friction to rebuild)
 */
const ARTIFACTS = [
  { name: 'node_modules',    match: 'node_modules',    risk: 'medium', ecosystem: 'Node.js' },
  { name: 'Rust target/',    match: 'target',          risk: 'medium', ecosystem: 'Rust',     parentCue: 'Cargo.toml' },
  { name: 'Python .venv',    match: '.venv',           risk: 'low',    ecosystem: 'Python' },
  { name: 'Python venv',     match: 'venv',            risk: 'low',    ecosystem: 'Python' },
  { name: 'Next .next/',     match: '.next',           risk: 'low',    ecosystem: 'Next.js' },
  { name: 'Next out/',       match: 'out',             risk: 'low',    ecosystem: 'Next.js', parentCue: 'next.config.js' },
  { name: 'Vite dist/',      match: 'dist',            risk: 'low',    ecosystem: 'Vite',    parentCue: 'vite.config.ts' },
  { name: 'Go build/',       match: 'build',           risk: 'low',    ecosystem: 'Generic' },
  { name: 'PHP vendor/',     match: 'vendor',          risk: 'medium', ecosystem: 'PHP',     parentCue: 'composer.json' },
  { name: 'CocoaPods Pods/', match: 'Pods',            risk: 'medium', ecosystem: 'iOS' },
  { name: 'Xcode DerivedData', match: 'DerivedData',   risk: 'low',    ecosystem: 'iOS' },
  { name: 'Android .gradle', match: '.gradle',         risk: 'medium', ecosystem: 'Android' },
  { name: 'Python __pycache__', match: '__pycache__',  risk: 'low',    ecosystem: 'Python' },
  { name: '.turbo cache',    match: '.turbo',          risk: 'low',    ecosystem: 'Turborepo' },
  { name: '.parcel-cache',   match: '.parcel-cache',   risk: 'low',    ecosystem: 'Parcel' },
];

const MAX_WALK_DEPTH = 5;
const SKIP_DIRS = new Set(['.Trash', 'Library', 'Applications', '.git', '.vscode', '.idea', 'node_modules']);

// ─── GIT STATUS ─────────────────────────────────────────────────────────────

/**
 * Get the last-commit time (unix seconds) for a git repo. 0 if not a repo.
 */
function getGitLastCommitTime(repoRoot) {
  try {
    const out = execSync(`git -C ${JSON.stringify(repoRoot)} log -1 --format=%ct 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

function findGitRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.pathExistsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

// ─── WALK ───────────────────────────────────────────────────────────────────

/**
 * Walk `root` looking for artifact directories. Stops at MAX_WALK_DEPTH.
 * Does NOT descend into artifact dirs themselves or into SKIP_DIRS.
 */
async function walkForArtifacts(root, depth, artifactsFound) {
  if (depth > MAX_WALK_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') && entry.name !== '.next' && entry.name !== '.venv' && entry.name !== '.turbo' && entry.name !== '.gradle' && entry.name !== '.parcel-cache') {
      // Skip hidden dirs except those we specifically want.
    }
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(root, entry.name);

    // Is this an artifact directory?
    const artifact = ARTIFACTS.find((a) => a.match === entry.name);
    if (artifact) {
      artifactsFound.push({ path: full, artifact });
      continue; // don't recurse into it
    }

    // Otherwise recurse.
    try {
      await walkForArtifacts(full, depth + 1, artifactsFound);
    } catch { /* skip */ }
  }
}

// ─── SCAN ───────────────────────────────────────────────────────────────────

/**
 * Scan all configured roots, group by git repo, return project summaries.
 */
async function scan({ roots = DEFAULT_ROOTS, dormantDuration, onProgress } = {}) {
  const dormantMs = dormantDuration ? parseDuration(dormantDuration) : null;
  const cutoff = dormantMs ? (Date.now() / 1000) - (dormantMs / 1000) : null;

  const found = [];
  for (const root of roots) {
    if (!(await fs.pathExists(root))) continue;
    await walkForArtifacts(root, 0, found);
    if (onProgress) onProgress({ root, foundCount: found.length });
  }

  // Group by enclosing git repo.
  const byRepo = new Map();
  for (const { path: artifactPath, artifact } of found) {
    const repoRoot = findGitRoot(path.dirname(artifactPath)) || path.dirname(artifactPath);
    if (!byRepo.has(repoRoot)) {
      byRepo.set(repoRoot, { repoRoot, artifacts: [], lastCommit: null, totalSize: 0 });
    }
    const size = await getDirSize(artifactPath).catch(() => 0);
    byRepo.get(repoRoot).artifacts.push({
      path: artifactPath,
      name: artifact.name,
      risk: artifact.risk,
      ecosystem: artifact.ecosystem,
      size,
      sizeFormatted: formatSize(size),
    });
    byRepo.get(repoRoot).totalSize += size;
  }

  // Compute git activity per repo.
  const projects = [];
  for (const proj of byRepo.values()) {
    const lastCommit = getGitLastCommitTime(proj.repoRoot);
    proj.lastCommit = lastCommit;
    proj.dormant = cutoff ? (lastCommit > 0 && lastCommit < cutoff) : false;
    proj.daysSinceCommit = lastCommit > 0
      ? Math.floor((Date.now() / 1000 - lastCommit) / (24 * 60 * 60))
      : null;
    proj.totalSizeFormatted = formatSize(proj.totalSize);
    projects.push(proj);
  }

  projects.sort((a, b) => b.totalSize - a.totalSize);

  const totalReclaimable = projects.reduce((s, p) => s + p.totalSize, 0);
  const dormantTotal = projects.filter((p) => p.dormant).reduce((s, p) => s + p.totalSize, 0);

  return {
    projects,
    totalReclaimable,
    totalReclaimableFormatted: formatSize(totalReclaimable),
    dormantCount: projects.filter((p) => p.dormant).length,
    dormantTotal,
    dormantTotalFormatted: formatSize(dormantTotal),
  };
}

// ─── CLEAN ──────────────────────────────────────────────────────────────────

/**
 * Clean specified artifact paths.
 */
async function cleanPaths(paths, { dryRun = false } = {}) {
  const results = [];
  for (const p of paths) {
    try {
      const size = await getDirSize(p);
      if (dryRun) {
        results.push({ path: p, size, action: 'would delete' });
      } else {
        await fs.remove(p);
        results.push({ path: p, size, action: 'cleaned' });
      }
    } catch (err) {
      results.push({ path: p, size: 0, action: 'error', error: err.message });
    }
  }
  return results;
}

module.exports = { scan, cleanPaths, DEFAULT_ROOTS, ARTIFACTS };
