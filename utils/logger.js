const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { formatSize } = require("./size");

const LOG_DIR = path.join(os.homedir(), ".aiclean", "logs");
const LOG_FILE = path.join(LOG_DIR, "aiclean.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB — rotate after this

/**
 * Ensure log directory exists.
 */
async function ensureLogDir() {
  await fs.ensureDir(LOG_DIR);
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE.
 */
async function rotateIfNeeded() {
  try {
    const exists = await fs.pathExists(LOG_FILE);
    if (!exists) return;

    const stat = await fs.stat(LOG_FILE);
    if (stat.size > MAX_LOG_SIZE) {
      const rotated = LOG_FILE + ".old";
      await fs.move(LOG_FILE, rotated, { overwrite: true });
    }
  } catch {
    // Rotation failure is non-critical
  }
}

/**
 * Append a log entry with timestamp.
 */
async function log(level, message, data = {}) {
  await ensureLogDir();
  await rotateIfNeeded();

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(LOG_FILE, line);
}

async function info(message, data) {
  await log("info", message, data);
}

async function warn(message, data) {
  await log("warn", message, data);
}

async function error(message, data) {
  await log("error", message, data);
}

/**
 * Log a clean operation with full details.
 */
async function logClean({ tool, toolId, paths, bytesReclaimed }) {
  await log("clean", `Cleaned ${tool}`, {
    toolId,
    paths,
    bytesReclaimed,
    bytesReclaimedFormatted: formatSize(bytesReclaimed),
  });
}

/**
 * Read log entries with optional filtering.
 */
async function readLogs(options = {}) {
  const { limit = 50, level, toolId, since } = options;

  try {
    const exists = await fs.pathExists(LOG_FILE);
    if (!exists) return [];

    const content = await fs.readFile(LOG_FILE, "utf-8");
    let entries = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Apply filters
    if (level) {
      entries = entries.filter((e) => e.level === level);
    }
    if (toolId) {
      entries = entries.filter((e) => e.toolId === toolId);
    }
    if (since) {
      const sinceDate = new Date(since);
      entries = entries.filter((e) => new Date(e.timestamp) >= sinceDate);
    }

    return entries.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Get cleaning history summary.
 */
async function getCleaningSummary() {
  const cleanLogs = await readLogs({ level: "clean", limit: 10000 });

  if (cleanLogs.length === 0) {
    return { totalCleans: 0, totalBytesReclaimed: 0, tools: {} };
  }

  let totalBytesReclaimed = 0;
  const tools = {};

  for (const entry of cleanLogs) {
    const bytes = entry.bytesReclaimed || 0;
    totalBytesReclaimed += bytes;

    const toolName = entry.toolId || "unknown";
    if (!tools[toolName]) {
      tools[toolName] = { cleans: 0, bytesReclaimed: 0 };
    }
    tools[toolName].cleans++;
    tools[toolName].bytesReclaimed += bytes;
  }

  return {
    totalCleans: cleanLogs.length,
    totalBytesReclaimed,
    totalBytesReclaimedFormatted: formatSize(totalBytesReclaimed),
    firstClean: cleanLogs[0]?.timestamp,
    lastClean: cleanLogs[cleanLogs.length - 1]?.timestamp,
    tools,
  };
}

/**
 * Clear all logs.
 */
async function clearLogs() {
  try {
    await fs.remove(LOG_FILE);
    const oldLog = LOG_FILE + ".old";
    await fs.remove(oldLog);
  } catch {
    // Non-critical
  }
}

module.exports = {
  info,
  warn,
  error,
  logClean,
  readLogs,
  getCleaningSummary,
  clearLogs,
  LOG_DIR,
  LOG_FILE,
};
