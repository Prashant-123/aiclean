const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const LOCK_DIR = path.join(os.homedir(), '.aiclean');
const LOCK_FILE = path.join(LOCK_DIR, 'clean.lock');
const LOCK_TIMEOUT = 30 * 60 * 1000; // 30 minutes — stale lock threshold

// ━━━ LOCKFILE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Acquire a lock to prevent concurrent clean operations.
 * Returns { acquired: boolean, reason?: string }
 */
async function acquireLock() {
  await fs.ensureDir(LOCK_DIR);

  try {
    const exists = await fs.pathExists(LOCK_FILE);
    if (exists) {
      const content = await fs.readJSON(LOCK_FILE);
      const age = Date.now() - new Date(content.timestamp).getTime();

      // Check if lock is stale
      if (age > LOCK_TIMEOUT) {
        await fs.remove(LOCK_FILE);
        // Fall through to acquire
      } else {
        return {
          acquired: false,
          reason: `Another clean is running (PID ${content.pid}, started ${new Date(content.timestamp).toLocaleTimeString()}). Use "aiclean unlock" to force release.`,
        };
      }
    }

    await fs.writeJSON(LOCK_FILE, {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
    });

    return { acquired: true };
  } catch (err) {
    return { acquired: false, reason: `Lock error: ${err.message}` };
  }
}

/**
 * Release the lock.
 */
async function releaseLock() {
  try {
    await fs.remove(LOCK_FILE);
  } catch {
    // Non-critical
  }
}

/**
 * Force-release a stale lock.
 */
async function forceUnlock() {
  await fs.remove(LOCK_FILE);
  return { success: true };
}

/**
 * Check if a lock is currently held.
 */
async function isLocked() {
  try {
    const exists = await fs.pathExists(LOCK_FILE);
    if (!exists) return { locked: false };

    const content = await fs.readJSON(LOCK_FILE);
    const age = Date.now() - new Date(content.timestamp).getTime();

    if (age > LOCK_TIMEOUT) {
      return { locked: false, stale: true };
    }

    return { locked: true, ...content };
  } catch {
    return { locked: false };
  }
}

// ━━━ PROCESS DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Check if any of the given process names are currently running.
 * Returns an array of { name, pid } for running processes.
 */
function checkRunningProcesses(processNames) {
  if (!processNames || processNames.length === 0) return [];

  const running = [];
  const platform = os.platform();

  for (const name of processNames) {
    try {
      let output;
      if (platform === 'darwin' || platform === 'linux') {
        output = execSync(`pgrep -x "${name}" 2>/dev/null || true`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
      }

      if (output) {
        const pids = output.split('\n').filter(Boolean);
        if (pids.length > 0) {
          running.push({ name, pids });
        }
      }
    } catch {
      // pgrep not available or timeout — skip
    }
  }

  return running;
}

/**
 * Check if a specific tool's processes are running.
 * Returns { running: boolean, processes: [], warning: string }
 */
function checkToolRunning(adapter) {
  const processes = checkRunningProcesses(adapter.processNames);

  if (processes.length > 0) {
    const names = processes.map((p) => p.name).join(', ');
    return {
      running: true,
      processes,
      warning: `${adapter.name} appears to be running (${names}). Cleaning while it's open may cause issues.`,
    };
  }

  return { running: false, processes: [] };
}

// ━━━ RISK ASSESSMENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Categorize scan results by risk level.
 */
function categorizeByRisk(scanResults) {
  const low = [];
  const medium = [];
  const high = [];

  for (const result of scanResults) {
    if (result.total === 0) continue;

    switch (result.risk) {
      case 'high':
        high.push(result);
        break;
      case 'medium':
        medium.push(result);
        break;
      default:
        low.push(result);
    }
  }

  return { low, medium, high };
}

/**
 * Get size threshold warning message.
 */
function getSizeWarning(totalBytes) {
  const GB = 1024 ** 3;

  if (totalBytes > 50 * GB) {
    return `You are about to delete ${formatBytes(totalBytes)}. This is an extremely large amount of data.`;
  }
  if (totalBytes > 20 * GB) {
    return `You are about to delete ${formatBytes(totalBytes)}. This is a significant amount of data.`;
  }
  if (totalBytes > 5 * GB) {
    return `You are about to delete ${formatBytes(totalBytes)}.`;
  }
  return null;
}

function formatBytes(bytes) {
  const { formatSize } = require('./size');
  return formatSize(bytes);
}

// ━━━ CRON STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Check the current status of the aiclean cron job.
 */
function getCronStatus() {
  try {
    const crontab = execSync('crontab -l 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const aicleanLines = crontab
      .split('\n')
      .filter((line) => line.includes('aiclean'));

    if (aicleanLines.length === 0) {
      return { active: false, schedule: null, line: null };
    }

    const line = aicleanLines[0];
    const schedule = parseSchedule(line);

    return { active: true, schedule, line: line.trim() };
  } catch {
    return { active: false, schedule: null, error: 'Could not read crontab' };
  }
}

/**
 * Parse a cron schedule into human-readable form.
 */
function parseSchedule(cronLine) {
  const parts = cronLine.trim().split(/\s+/);
  if (parts.length < 5) return 'unknown';

  const [min, hour, dom, , dow] = parts;

  if (dom === '1' && dow === '*') return `monthly (day 1 at ${hour}:${min.padStart(2, '0')})`;
  if (dow === '1' && dom === '*') return `weekly (Monday at ${hour}:${min.padStart(2, '0')})`;
  if (dom === '*' && dow === '*') return `daily (at ${hour}:${min.padStart(2, '0')})`;

  return `custom (${parts.slice(0, 5).join(' ')})`;
}

module.exports = {
  acquireLock,
  releaseLock,
  forceUnlock,
  isLocked,
  checkRunningProcesses,
  checkToolRunning,
  categorizeByRisk,
  getSizeWarning,
  getCronStatus,
  LOCK_FILE,
};
