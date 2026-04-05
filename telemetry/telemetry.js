const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { formatSize } = require("../utils/size");

const TELEMETRY_DIR = path.join(os.homedir(), ".aiclean", "telemetry");
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, "stats.json");

/**
 * Local telemetry module — fully functional.
 * Tracks usage metrics locally on disk.
 * No data is sent externally unless the user opts in to the API.
 */

let enabled = true;
let stats = null;

function getDefaultStats() {
  return {
    totalScans: 0,
    totalCleans: 0,
    totalBytesReclaimed: 0,
    totalToolsScanned: 0,
    firstUsed: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    scanHistory: [],
    cleanHistory: [],
  };
}

/**
 * Initialize telemetry — load existing stats from disk.
 */
async function init(config = {}) {
  enabled = config.telemetry !== false;
  if (!enabled) return;

  await fs.ensureDir(TELEMETRY_DIR);

  try {
    const exists = await fs.pathExists(TELEMETRY_FILE);
    if (exists) {
      const content = await fs.readFile(TELEMETRY_FILE, "utf-8");
      stats = JSON.parse(content);
    } else {
      stats = getDefaultStats();
      await save();
    }
  } catch {
    stats = getDefaultStats();
  }
}

/**
 * Save stats to disk.
 */
async function save() {
  if (!enabled || !stats) return;
  try {
    await fs.ensureDir(TELEMETRY_DIR);
    await fs.writeFile(TELEMETRY_FILE, JSON.stringify(stats, null, 2) + "\n");
  } catch {
    // Non-critical
  }
}

/**
 * Track a scan event.
 */
async function trackScan(toolCount, totalBytes) {
  if (!enabled || !stats) return;

  stats.totalScans++;
  stats.totalToolsScanned += toolCount;
  stats.lastUsed = new Date().toISOString();

  // Keep last 100 scan events
  stats.scanHistory.push({
    timestamp: new Date().toISOString(),
    toolCount,
    totalBytes,
    totalFormatted: formatSize(totalBytes),
  });
  if (stats.scanHistory.length > 100) {
    stats.scanHistory = stats.scanHistory.slice(-100);
  }

  await save();
}

/**
 * Track a clean event.
 */
async function trackClean(bytesReclaimed) {
  if (!enabled || !stats) return;

  stats.totalCleans++;
  stats.totalBytesReclaimed += bytesReclaimed;
  stats.lastUsed = new Date().toISOString();

  // Keep last 100 clean events
  stats.cleanHistory.push({
    timestamp: new Date().toISOString(),
    bytesReclaimed,
    bytesReclaimedFormatted: formatSize(bytesReclaimed),
  });
  if (stats.cleanHistory.length > 100) {
    stats.cleanHistory = stats.cleanHistory.slice(-100);
  }

  await save();
}

/**
 * Get current stats.
 */
function getStats() {
  const s = stats || getDefaultStats();
  return {
    ...s,
    totalBytesReclaimedFormatted: formatSize(s.totalBytesReclaimed),
  };
}

/**
 * Get a human-readable summary.
 */
function getSummary() {
  const s = getStats();
  return {
    totalScans: s.totalScans,
    totalCleans: s.totalCleans,
    totalReclaimed: s.totalBytesReclaimedFormatted,
    memberSince: s.firstUsed,
    lastActive: s.lastUsed,
  };
}

/**
 * Reset all telemetry data.
 */
async function reset() {
  stats = getDefaultStats();
  await save();
}

module.exports = {
  init,
  trackScan,
  trackClean,
  getStats,
  getSummary,
  reset,
  save,
  TELEMETRY_DIR,
  TELEMETRY_FILE,
};
