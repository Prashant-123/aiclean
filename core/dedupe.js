/**
 * Duplicate model & weight detection (Pro feature).
 *
 * Many developers have the same model downloaded multiple times across
 * different frameworks. Common example: llama3-8b lives in
 *   ~/.ollama/models/blobs/           (via Ollama)
 *   ~/.cache/huggingface/hub/...      (via `transformers`)
 *   ~/.cache/lm-studio/models/        (via LM Studio)
 *   ~/.cache/torch/hub/               (via torch.hub)
 *
 * We hash files >100MB in those caches with Blake3 (fast, pure-JS) and
 * surface duplicates. Optionally the user can hardlink them to reclaim
 * disk without breaking any tool.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const { formatSize } = require('../utils/size');

const DEFAULT_MIN_SIZE = 100 * 1024 * 1024; // 100 MB

const DEFAULT_ROOTS = [
  { name: 'Ollama blobs',       path: path.join(os.homedir(), '.ollama', 'models', 'blobs') },
  { name: 'HuggingFace hub',    path: path.join(os.homedir(), '.cache', 'huggingface', 'hub') },
  { name: 'HuggingFace transformers', path: path.join(os.homedir(), '.cache', 'huggingface', 'transformers') },
  { name: 'LM Studio models',   path: path.join(os.homedir(), '.cache', 'lm-studio', 'models') },
  { name: 'LM Studio models (macOS)', path: path.join(os.homedir(), 'Library', 'Application Support', 'LM Studio', 'models') },
  { name: 'PyTorch hub',        path: path.join(os.homedir(), '.cache', 'torch', 'hub') },
  { name: 'Diffusers cache',    path: path.join(os.homedir(), '.cache', 'huggingface', 'diffusers') },
  { name: 'llama.cpp models',   path: path.join(os.homedir(), 'llama.cpp', 'models') },
];

// ─── HASHING ────────────────────────────────────────────────────────────────

/**
 * Hash a file using SHA-256 (built-in, no deps, fast enough for our needs).
 * We read in 1MB chunks to stay friendly to RAM on huge files.
 *
 * For now we use SHA-256 rather than Blake3 to keep the dep surface small;
 * can swap to @noble/hashes/blake3 later if we need the speed.
 */
async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ─── WALK ───────────────────────────────────────────────────────────────────

async function* walkLargeFiles(dirPath, minSize) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        yield* walkLargeFiles(full, minSize);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        if (stat.size >= minSize) {
          yield { path: full, size: stat.size, ino: stat.ino, dev: stat.dev };
        }
      }
    } catch {
      // Permission / transient — skip.
    }
  }
}

// ─── SCAN ───────────────────────────────────────────────────────────────────

/**
 * Scan all configured roots for large files and group by content hash.
 * Returns { duplicates, totalWaste, filesScanned, filesHashed }.
 */
async function scan({ roots = DEFAULT_ROOTS, minSize = DEFAULT_MIN_SIZE, onProgress } = {}) {
  // Step 1: collect all candidate files grouped by size (cheap pre-filter).
  const bySize = new Map(); // size -> [{path, ino, dev}, ...]
  let filesScanned = 0;

  for (const root of roots) {
    if (!(await fs.pathExists(root.path))) continue;
    for await (const entry of walkLargeFiles(root.path, minSize)) {
      filesScanned++;
      const arr = bySize.get(entry.size) || [];
      arr.push({ ...entry, rootName: root.name });
      bySize.set(entry.size, arr);
      if (onProgress) onProgress({ phase: 'walk', filesScanned });
    }
  }

  // Step 2: for any size with >1 file, hash them and group by hash.
  const byHash = new Map();
  let filesHashed = 0;
  for (const [size, files] of bySize) {
    if (files.length < 2) continue;
    for (const file of files) {
      try {
        const hash = await hashFile(file.path);
        const arr = byHash.get(hash) || { size, files: [] };
        arr.files.push(file);
        byHash.set(hash, arr);
        filesHashed++;
        if (onProgress) onProgress({ phase: 'hash', filesHashed, ofTotal: files.length });
      } catch { /* skip */ }
    }
  }

  // Step 3: derive duplicate groups.
  const duplicates = [];
  let totalWaste = 0;
  for (const [hash, { size, files }] of byHash) {
    // Exclude files that are already the same inode (hardlinked).
    const uniqueInodes = new Set(files.map((f) => `${f.dev}:${f.ino}`));
    if (files.length < 2 || uniqueInodes.size < 2) continue;
    const copies = files.length;
    const waste = size * (copies - 1);
    totalWaste += waste;
    duplicates.push({
      hash,
      size,
      sizeFormatted: formatSize(size),
      copies,
      wasteFormatted: formatSize(waste),
      files,
    });
  }

  duplicates.sort((a, b) => (b.size * (b.copies - 1)) - (a.size * (a.copies - 1)));

  return {
    duplicates,
    totalWaste,
    totalWasteFormatted: formatSize(totalWaste),
    filesScanned,
    filesHashed,
    groupCount: duplicates.length,
  };
}

// ─── HARDLINK ───────────────────────────────────────────────────────────────

/**
 * Replace all duplicates in a group with hardlinks to the first file.
 * This reclaims disk immediately but requires all files be on the same
 * filesystem (different `dev` = can't hardlink).
 */
async function hardlinkGroup(group, { dryRun = false } = {}) {
  const source = group.files[0];
  const results = [];

  for (let i = 1; i < group.files.length; i++) {
    const target = group.files[i];
    if (target.dev !== source.dev) {
      results.push({ path: target.path, action: 'skip', reason: 'different filesystem' });
      continue;
    }
    if (dryRun) {
      results.push({ path: target.path, action: 'would-link', sourcePath: source.path, size: group.size });
      continue;
    }
    try {
      const tmp = target.path + '.aiclean-dedupe-tmp';
      await fs.rename(target.path, tmp);
      try {
        await fs.link(source.path, target.path);
        await fs.remove(tmp);
        results.push({ path: target.path, action: 'linked', sourcePath: source.path, size: group.size });
      } catch (err) {
        // Link failed — put the original back.
        await fs.rename(tmp, target.path).catch(() => {});
        results.push({ path: target.path, action: 'error', reason: err.message });
      }
    } catch (err) {
      results.push({ path: target.path, action: 'error', reason: err.message });
    }
  }

  return results;
}

module.exports = { scan, hardlinkGroup, DEFAULT_ROOTS, DEFAULT_MIN_SIZE };
