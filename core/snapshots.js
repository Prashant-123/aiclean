/**
 * Snapshot & rollback engine (Pro feature).
 *
 * Creates a filesystem-level restore point BEFORE a clean, so users can
 * roll back if they regret deleting something. Supports:
 *
 *   macOS        → APFS local snapshots via `tmutil localsnapshot`
 *   Linux/btrfs  → `btrfs subvolume snapshot`
 *   Linux/ZFS    → `zfs snapshot`
 *
 * Snapshots are filesystem features with effectively zero disk cost at
 * creation time (copy-on-write), so creating one before every clean is free.
 *
 * Snapshots are NOT application-level backups — they cover the whole volume.
 * For APFS, users restore via `tmutil` or `diskutil apfs revert`. For
 * btrfs/zfs, we can shell out directly for rollback since the user owns the
 * subvolume.
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const SNAPSHOT_DIR = path.join(os.homedir(), '.aiclean', 'snapshots');
const SNAPSHOT_INDEX = path.join(SNAPSHOT_DIR, 'index.json');
const DEFAULT_RETENTION = 5;

// ─── DETECTION ──────────────────────────────────────────────────────────────

/**
 * Detect what snapshot backend is available on the current system.
 * Returns one of: 'apfs', 'btrfs', 'zfs', 'none'.
 */
function detectBackend() {
  const platform = os.platform();

  if (platform === 'darwin') {
    // APFS is the default on macOS 10.13+. Check we can call tmutil.
    try {
      execSync('command -v tmutil', { stdio: 'pipe' });
      return 'apfs';
    } catch {
      return 'none';
    }
  }

  if (platform === 'linux') {
    // Check the filesystem of $HOME.
    try {
      const fstype = execSync(`stat -f -c %T ${JSON.stringify(os.homedir())}`, {
        stdio: 'pipe',
      }).toString().trim();

      if (fstype === 'btrfs') {
        try {
          execSync('command -v btrfs', { stdio: 'pipe' });
          return 'btrfs';
        } catch { /* fallthrough */ }
      }
      if (fstype === 'zfs') {
        try {
          execSync('command -v zfs', { stdio: 'pipe' });
          return 'zfs';
        } catch { /* fallthrough */ }
      }
    } catch {
      // stat failed — treat as none
    }
  }

  return 'none';
}

// ─── INDEX ──────────────────────────────────────────────────────────────────

async function readIndex() {
  try {
    if (!(await fs.pathExists(SNAPSHOT_INDEX))) {
      return { snapshots: [] };
    }
    return await fs.readJSON(SNAPSHOT_INDEX);
  } catch {
    return { snapshots: [] };
  }
}

async function writeIndex(idx) {
  await fs.ensureDir(SNAPSHOT_DIR);
  await fs.writeJSON(SNAPSHOT_INDEX, idx, { spaces: 2 });
}

// ─── CREATE ─────────────────────────────────────────────────────────────────

/**
 * Create a snapshot before a clean. Returns metadata for later restore.
 */
async function create({ reason = 'pre-clean', backend: forceBackend } = {}) {
  const backend = forceBackend || detectBackend();

  if (backend === 'none') {
    return {
      success: false,
      skipped: true,
      reason: 'No supported snapshot backend on this system (APFS / btrfs / ZFS required).',
    };
  }

  const id = `aiclean-${Date.now()}`;
  const timestamp = new Date().toISOString();

  try {
    let nativeId = null;
    let restoreHint = null;

    if (backend === 'apfs') {
      // tmutil localsnapshot returns: "Created local snapshot with date: 2026-04-16-134500"
      const output = execSync('tmutil localsnapshot', { stdio: 'pipe', timeout: 15000 })
        .toString()
        .trim();
      const match = output.match(/with date:\s*([0-9\-]+)/);
      nativeId = match ? match[1] : timestamp;
      restoreHint = 'Reboot into Recovery, open Disk Utility → Revert to snapshot, select `' + nativeId + '`. aiclean can also list + delete it for you.';
    } else if (backend === 'btrfs') {
      const home = os.homedir();
      const snapPath = path.join(SNAPSHOT_DIR, id);
      await fs.ensureDir(SNAPSHOT_DIR);
      execSync(`btrfs subvolume snapshot -r ${JSON.stringify(home)} ${JSON.stringify(snapPath)}`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      nativeId = snapPath;
      restoreHint = `Restore with: aiclean restore --id ${id}`;
    } else if (backend === 'zfs') {
      // Find the dataset containing $HOME
      const ds = execSync(`zfs list -H -o name,mountpoint | awk -v h=${JSON.stringify(os.homedir())} '$2==h {print $1}'`, {
        stdio: 'pipe',
      }).toString().trim();
      if (!ds) throw new Error('Could not find ZFS dataset for $HOME');
      execSync(`zfs snapshot ${ds}@${id}`, { stdio: 'pipe', timeout: 30000 });
      nativeId = `${ds}@${id}`;
      restoreHint = `Restore with: aiclean restore --id ${id}`;
    }

    const snapshot = {
      id,
      backend,
      nativeId,
      timestamp,
      reason,
      restoreHint,
    };

    const idx = await readIndex();
    idx.snapshots.unshift(snapshot);
    await writeIndex(idx);

    return { success: true, snapshot };
  } catch (err) {
    return {
      success: false,
      skipped: false,
      reason: err.message || String(err),
      backend,
    };
  }
}

// ─── LIST ───────────────────────────────────────────────────────────────────

async function list() {
  const idx = await readIndex();
  return idx.snapshots;
}

// ─── RESTORE ────────────────────────────────────────────────────────────────

/**
 * Restore a snapshot by id.
 * APFS restore requires Recovery boot and is NOT automated — we print
 * instructions instead. btrfs/zfs rollback can be automated.
 */
async function restore(id) {
  const idx = await readIndex();
  const snap = idx.snapshots.find((s) => s.id === id);
  if (!snap) {
    return { success: false, reason: `Snapshot "${id}" not found.` };
  }

  if (snap.backend === 'apfs') {
    return {
      success: false,
      manual: true,
      message:
        'APFS local snapshots cannot be restored from userspace.\n' +
        '  To restore: reboot holding ⌘+R (Intel) or the power button (Apple Silicon),\n' +
        '  open Disk Utility → Restore From Time Machine Backup,\n' +
        '  and select snapshot: ' + snap.nativeId,
    };
  }

  if (snap.backend === 'btrfs') {
    const home = os.homedir();
    const backup = home + '.aiclean-pre-restore-' + Date.now();
    try {
      // Rename current home, then copy snapshot into place.
      // This is intentionally conservative — we never `rm` the user's home.
      execSync(`mv ${JSON.stringify(home)} ${JSON.stringify(backup)}`, { stdio: 'pipe' });
      execSync(`btrfs subvolume snapshot ${JSON.stringify(snap.nativeId)} ${JSON.stringify(home)}`, { stdio: 'pipe' });
      return {
        success: true,
        message: `Restored from ${snap.id}. Previous home renamed to ${backup}; delete when you're sure.`,
      };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  if (snap.backend === 'zfs') {
    try {
      execSync(`zfs rollback -r ${JSON.stringify(snap.nativeId)}`, { stdio: 'pipe' });
      return { success: true, message: `Rolled back ZFS dataset to snapshot ${snap.id}.` };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  return { success: false, reason: `Unknown backend: ${snap.backend}` };
}

// ─── DELETE / PRUNE ─────────────────────────────────────────────────────────

async function remove(id) {
  const idx = await readIndex();
  const snap = idx.snapshots.find((s) => s.id === id);
  if (!snap) return { success: false, reason: `Not found: ${id}` };

  try {
    if (snap.backend === 'apfs') {
      execSync(`tmutil deletelocalsnapshots ${JSON.stringify(snap.nativeId)}`, { stdio: 'pipe' });
    } else if (snap.backend === 'btrfs') {
      execSync(`btrfs subvolume delete ${JSON.stringify(snap.nativeId)}`, { stdio: 'pipe' });
    } else if (snap.backend === 'zfs') {
      execSync(`zfs destroy ${JSON.stringify(snap.nativeId)}`, { stdio: 'pipe' });
    }
  } catch (err) {
    return { success: false, reason: err.message };
  }

  idx.snapshots = idx.snapshots.filter((s) => s.id !== id);
  await writeIndex(idx);
  return { success: true };
}

/**
 * Keep the N most recent snapshots, delete older ones.
 */
async function prune(keep = DEFAULT_RETENTION) {
  const idx = await readIndex();
  const toRemove = idx.snapshots.slice(keep);
  const removed = [];
  for (const s of toRemove) {
    const r = await remove(s.id);
    if (r.success) removed.push(s.id);
  }
  return { removed, kept: Math.min(keep, idx.snapshots.length - toRemove.length + removed.length) };
}

module.exports = {
  detectBackend,
  create,
  list,
  restore,
  remove,
  prune,
  SNAPSHOT_DIR,
};
