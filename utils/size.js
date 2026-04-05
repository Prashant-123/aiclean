const fs = require("fs-extra");
const path = require("path");

/**
 * Recursively calculate directory size in bytes.
 */
async function getDirSize(dirPath) {
  let totalSize = 0;

  try {
    const exists = await fs.pathExists(dirPath);
    if (!exists) return 0;

    const stat = await fs.stat(dirPath);
    if (stat.isFile()) return stat.size;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          continue; // skip symlinks to avoid loops
        } else if (entry.isDirectory()) {
          totalSize += await getDirSize(fullPath);
        } else if (entry.isFile()) {
          const fileStat = await fs.stat(fullPath);
          totalSize += fileStat.size;
        }
      } catch {
        // Permission denied or other errors — skip silently
      }
    }
  } catch {
    // Directory inaccessible
  }

  return totalSize;
}

/**
 * Format bytes into human-readable string.
 */
function formatSize(bytes) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = (bytes / Math.pow(k, i)).toFixed(i >= 2 ? 1 : 0);

  return `${size} ${units[i]}`;
}

/**
 * Parse a size string like "1.2 GB" back to bytes.
 */
function parseSize(sizeStr) {
  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return 0;
  return parseFloat(match[1]) * (units[match[2].toUpperCase()] || 1);
}

/**
 * Parse a duration string like "30d", "2w", "6h" into milliseconds.
 * Supported units: h (hours), d (days), w (weeks).
 */
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*(h|d|w)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Recursively calculate directory size, only counting files
 * with atime older than the given threshold (in ms from now).
 */
async function getDirSizeFiltered(dirPath, olderThanMs) {
  let totalSize = 0;
  const cutoff = Date.now() - olderThanMs;

  try {
    const exists = await fs.pathExists(dirPath);
    if (!exists) return 0;

    const stat = await fs.stat(dirPath);
    if (stat.isFile()) {
      return stat.atimeMs < cutoff ? stat.size : 0;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          continue;
        } else if (entry.isDirectory()) {
          totalSize += await getDirSizeFiltered(fullPath, olderThanMs);
        } else if (entry.isFile()) {
          const fileStat = await fs.stat(fullPath);
          if (fileStat.atimeMs < cutoff) {
            totalSize += fileStat.size;
          }
        }
      } catch {
        // Permission denied or other errors — skip silently
      }
    }
  } catch {
    // Directory inaccessible
  }

  return totalSize;
}

/**
 * Recursively delete only files with atime older than the threshold.
 * Preserves directory structure and fresh files.
 */
async function cleanDirFiltered(dirPath, olderThanMs) {
  const cutoff = Date.now() - olderThanMs;

  try {
    const exists = await fs.pathExists(dirPath);
    if (!exists) return;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          continue;
        } else if (entry.isDirectory()) {
          await cleanDirFiltered(fullPath, olderThanMs);
        } else if (entry.isFile()) {
          const fileStat = await fs.stat(fullPath);
          if (fileStat.atimeMs < cutoff) {
            await fs.remove(fullPath);
          }
        }
      } catch {
        // Permission denied or other errors — skip silently
      }
    }
  } catch {
    // Directory inaccessible
  }
}

module.exports = { getDirSize, getDirSizeFiltered, formatSize, parseSize, parseDuration, cleanDirFiltered };
