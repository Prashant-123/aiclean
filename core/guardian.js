/**
 * Pre-flight disk guardian (Pro feature).
 *
 * Intercepts AI/dev-tool downloads BEFORE they start and:
 *   1. Estimates the download size (tool-specific logic)
 *   2. Checks free disk space
 *   3. If close to full, offers to free up the delta via `aiclean clean`
 *   4. On interrupt, cleans up orphaned partial downloads
 *
 * Install model: we generate shim scripts into ~/.aiclean/shims/ and ask the
 * user to prepend that dir to PATH. The shim calls back into aiclean, which
 * runs the pre-flight check and then exec()s the real tool.
 *
 * Supported tools:
 *   - ollama       → uses manifest API to estimate `pull` size
 *   - huggingface  → uses HF API to estimate model + revision size
 *   - docker       → rough estimate via image manifest
 *   - pip / uv     → conservative; can't know without resolving
 *   - npm / pnpm   → same
 *   - cargo        → same
 *
 * The shim is opt-in. Users run `aiclean guard install` to install, and
 * `aiclean guard uninstall` to remove. The free CLI detects orphaned Ollama
 * partials; size estimation + active interception is Pro.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SHIMS_DIR = path.join(os.homedir(), '.aiclean', 'shims');
const GUARD_CONFIG = path.join(os.homedir(), '.aiclean', 'guard.json');

const SUPPORTED_COMMANDS = ['ollama', 'huggingface-cli', 'docker', 'pip', 'npm', 'cargo', 'uv'];

// ─── DISK INFO ──────────────────────────────────────────────────────────────

/**
 * Get free bytes on the filesystem containing the given path.
 * Uses statfs/statvfs via Node's built-in.
 */
function getFreeBytes(targetPath) {
  try {
    const stats = fs.statfsSync ? fs.statfsSync(targetPath) : require('fs').statfsSync(targetPath);
    return stats.bavail * stats.bsize;
  } catch {
    // Fallback: shell out to `df`.
    try {
      const output = execSync(`df -Pk ${JSON.stringify(targetPath)} | tail -1`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      const parts = output.trim().split(/\s+/);
      const availKB = parseInt(parts[3], 10);
      return availKB * 1024;
    } catch {
      return -1;
    }
  }
}

// ─── OLLAMA ─────────────────────────────────────────────────────────────────

/**
 * Estimate Ollama pull size via the registry manifest API.
 * Fetch: https://registry.ollama.ai/v2/library/MODEL/manifests/TAG
 * Sum all layer sizes.
 */
async function estimateOllamaPull(modelSpec) {
  // modelSpec like "llama3:8b" or "library/llama3:latest"
  let name = modelSpec;
  let tag = 'latest';
  if (modelSpec.includes(':')) {
    [name, tag] = modelSpec.split(':');
  }
  if (!name.includes('/')) name = `library/${name}`;

  try {
    const url = `https://registry.ollama.ai/v2/${name}/manifests/${tag}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    let total = 0;
    for (const layer of body.layers || []) total += layer.size || 0;
    return total;
  } catch {
    return null;
  }
}

/**
 * Find orphaned Ollama partial downloads.
 * Returns [{ path, size }] for each partial blob we can safely delete.
 */
async function findOllamaOrphans() {
  const blobsDir = path.join(os.homedir(), '.ollama', 'models', 'blobs');
  if (!(await fs.pathExists(blobsDir))) return [];

  const entries = await fs.readdir(blobsDir).catch(() => []);
  const orphans = [];
  for (const name of entries) {
    if (name.endsWith('-partial') || name.endsWith('.partial') || name.includes('.incomplete')) {
      try {
        const full = path.join(blobsDir, name);
        const stat = await fs.stat(full);
        orphans.push({ path: full, size: stat.size });
      } catch { /* skip */ }
    }
  }
  return orphans;
}

// ─── HUGGINGFACE ────────────────────────────────────────────────────────────

/**
 * Estimate HF model size via the Hub API.
 * GET https://huggingface.co/api/models/MODEL/revision/REV with ?blobs=true
 */
async function estimateHFModel(repoId, revision = 'main') {
  try {
    const url = `https://huggingface.co/api/models/${encodeURIComponent(repoId)}/tree/${encodeURIComponent(revision)}?recursive=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    let total = 0;
    for (const entry of body) {
      if (entry.type === 'file' && typeof entry.size === 'number') {
        total += entry.size;
      }
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * HF orphan detection: revisions that are pointed at by no ref.
 * Lightweight heuristic: `hf cache prune --help` exists in newer versions
 * but not everywhere, so we just detect .incomplete files.
 */
async function findHFOrphans() {
  const hub = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
  if (!(await fs.pathExists(hub))) return [];

  const orphans = [];
  const walk = async (dir) => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.incomplete') || entry.name.endsWith('.lock'))) {
        try {
          const stat = await fs.stat(full);
          if (stat.size > 0) orphans.push({ path: full, size: stat.size });
        } catch { /* skip */ }
      }
    }
  };
  await walk(hub);
  return orphans;
}

// ─── PRE-FLIGHT CHECK ───────────────────────────────────────────────────────

/**
 * Run the pre-flight check for a planned download.
 * Returns { ok, freeBytes, requiredBytes, deficit, shouldOffer }.
 */
async function preflight({ requiredBytes, bufferBytes = 2 * 1024 ** 3, targetPath = os.homedir() }) {
  const free = getFreeBytes(targetPath);
  if (free < 0 || requiredBytes == null) {
    return { ok: true, skipped: true, freeBytes: free, requiredBytes };
  }
  const needed = requiredBytes + bufferBytes;
  const ok = free >= needed;
  return {
    ok,
    freeBytes: free,
    requiredBytes,
    bufferBytes,
    deficit: Math.max(0, needed - free),
    shouldOffer: !ok,
  };
}

// ─── SHIM INSTALL ───────────────────────────────────────────────────────────

async function installShims(commands = SUPPORTED_COMMANDS) {
  await fs.ensureDir(SHIMS_DIR);
  const installed = [];
  const skipped = [];

  for (const cmd of commands) {
    // Resolve the real binary location NOW and pin it in the shim so we don't
    // loop back into ourselves.
    let realPath;
    try {
      realPath = execSync(`command -v ${cmd}`, { stdio: 'pipe' }).toString().trim();
    } catch {
      skipped.push({ cmd, reason: 'not installed' });
      continue;
    }
    if (!realPath || realPath.startsWith(SHIMS_DIR)) {
      skipped.push({ cmd, reason: 'not found / already shimmed' });
      continue;
    }

    const shimPath = path.join(SHIMS_DIR, cmd);
    const content = `#!/usr/bin/env bash
# aiclean guard shim for ${cmd}
# Real binary: ${realPath}
# Do NOT edit manually — regenerate with \`aiclean guard install\`.
exec aiclean guard invoke --tool ${cmd} --real ${JSON.stringify(realPath)} -- "$@"
`;
    await fs.writeFile(shimPath, content, { mode: 0o755 });
    installed.push({ cmd, shimPath, realPath });
  }

  await fs.writeJSON(GUARD_CONFIG, {
    installedAt: new Date().toISOString(),
    shims: installed,
  }, { spaces: 2 });

  return { installed, skipped, shimsDir: SHIMS_DIR };
}

async function uninstallShims() {
  if (await fs.pathExists(SHIMS_DIR)) {
    await fs.remove(SHIMS_DIR);
  }
  if (await fs.pathExists(GUARD_CONFIG)) {
    await fs.remove(GUARD_CONFIG);
  }
  return { success: true };
}

async function guardStatus() {
  const exists = await fs.pathExists(GUARD_CONFIG);
  if (!exists) return { installed: false };
  const cfg = await fs.readJSON(GUARD_CONFIG);
  const shell = process.env.SHELL || '';
  const inPath = (process.env.PATH || '').split(':').includes(SHIMS_DIR);
  return {
    installed: true,
    installedAt: cfg.installedAt,
    shimCount: cfg.shims.length,
    shims: cfg.shims,
    shimsDir: SHIMS_DIR,
    shell,
    inPath,
    pathHint: inPath ? null : `Add "${SHIMS_DIR}" to the FRONT of your PATH. For zsh: echo 'export PATH="${SHIMS_DIR}:$PATH"' >> ~/.zshrc`,
  };
}

// ─── INVOKE ─────────────────────────────────────────────────────────────────

/**
 * Called by a shim. Runs pre-flight, then exec()s the real binary.
 * argv is [...tool-args].
 */
async function invoke({ tool, real, argv }) {
  // Only estimate for the handful of subcommands where it makes sense.
  let estimate = null;
  try {
    if (tool === 'ollama' && argv[0] === 'pull' && argv[1]) {
      estimate = await estimateOllamaPull(argv[1]);
    } else if (tool === 'huggingface-cli' && argv[0] === 'download' && argv[1]) {
      estimate = await estimateHFModel(argv[1]);
    }
    // docker/pip/npm/cargo: we don't have a cheap size estimate; skip.
  } catch { /* best-effort */ }

  if (estimate != null && estimate > 0) {
    const check = await preflight({ requiredBytes: estimate });
    if (check.shouldOffer) {
      return { intercepted: true, check, estimate, tool, argv };
    }
  }

  // No concerns — exec the real binary transparently.
  return { intercepted: false, tool, real, argv, estimate };
}

module.exports = {
  detectBackend: undefined, // intentional — keep surface focused
  getFreeBytes,
  estimateOllamaPull,
  findOllamaOrphans,
  estimateHFModel,
  findHFOrphans,
  preflight,
  installShims,
  uninstallShims,
  guardStatus,
  invoke,
  SHIMS_DIR,
  SUPPORTED_COMMANDS,
};
