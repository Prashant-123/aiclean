/**
 * Smart rules engine (Pro feature).
 *
 * Upgrades the old cron-based auto-clean into a condition-based scheduler.
 * Rules live in ~/.aicleanrc under the `rules` key:
 *
 *   "rules": [
 *     {
 *       "id":   "disk-emergency",
 *       "when": { "disk.freePercent": "< 15" },
 *       "do":   { "action": "clean", "risk": "medium" }
 *     },
 *     {
 *       "id":   "weekly-low-risk",
 *       "when": { "time.dayOfWeek": "Mon", "time.hour": "9" },
 *       "do":   { "action": "clean", "risk": "low" }
 *     },
 *     {
 *       "id":   "docker-bloat",
 *       "when": {
 *         "tool": "docker",
 *         "tool.size": "> 10GB",
 *         "tool.idleDays": "> 7"
 *       },
 *       "do":   { "action": "clean", "only": "docker" }
 *     }
 *   ]
 *
 * Evaluation runs on an interval (default 15 min) via a daemon installed
 * as a launchd agent (macOS) or systemd user service (Linux).
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { parseDuration, parseSize, formatSize } = require('../utils/size');

const DAEMON_LABEL = 'com.aiclean.daemon';
const LAUNCHD_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
const SYSTEMD_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', 'aiclean.service');
const SYSTEMD_TIMER_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', 'aiclean.timer');
const DAEMON_LOG = path.join(os.homedir(), '.aiclean', 'daemon.log');
const DAEMON_PID = path.join(os.homedir(), '.aiclean', 'daemon.pid');

// ─── CONDITION EVALUATION ───────────────────────────────────────────────────

/**
 * Parse a condition string like ">= 15", "< 10GB", "> 7d" into a matcher fn.
 */
function parseCondition(str) {
  if (typeof str === 'number' || typeof str === 'boolean') {
    return (value) => value === str;
  }
  if (typeof str !== 'string') return () => true;

  const trimmed = str.trim();
  const m = trimmed.match(/^([<>=!]=?|=|==)\s*(.+)$/);
  if (!m) {
    return (value) => value === trimmed;
  }
  const op = m[1];
  const raw = m[2];

  // Try parse number, then size, then duration, then fall back to string.
  let target;
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    target = parseFloat(raw);
  } else if (/[KMGT]B$/i.test(raw)) {
    target = parseSize(raw);
  } else if (/^\d+(h|d|w)$/i.test(raw)) {
    target = parseDuration(raw);
  } else {
    target = raw;
  }

  switch (op) {
    case '<':  return (v) => v <  target;
    case '<=': return (v) => v <= target;
    case '>':  return (v) => v >  target;
    case '>=': return (v) => v >= target;
    case '=':
    case '==': return (v) => v === target;
    case '!=': return (v) => v !== target;
    default:   return () => false;
  }
}

/**
 * Evaluate the `when` clause against the current context.
 */
function matchesWhen(whenClause, context) {
  for (const [key, cond] of Object.entries(whenClause)) {
    const value = getContextValue(context, key);
    const matcher = parseCondition(cond);
    if (!matcher(value)) return false;
  }
  return true;
}

/**
 * Look up a dotted key in the context object.
 */
function getContextValue(context, key) {
  const parts = key.split('.');
  let value = context;
  for (const p of parts) {
    if (value == null) return undefined;
    value = value[p];
  }
  return value;
}

// ─── CONTEXT BUILDER ────────────────────────────────────────────────────────

/**
 * Build the evaluation context. This is what rules are matched against.
 * Lazily computed so we don't do expensive scans unless a rule needs them.
 */
async function buildContext({ scanResult = null } = {}) {
  const now = new Date();

  const ctx = {
    time: {
      hour: now.getHours(),
      minute: now.getMinutes(),
      dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()],
      dayOfMonth: now.getDate(),
      iso: now.toISOString(),
    },
    disk: {
      freeBytes: 0,
      freePercent: 0,
      totalBytes: 0,
    },
    power: getPowerInfo(),
    tool: scanResult ? scanResultToToolMap(scanResult) : {},
  };

  // Disk.
  try {
    const stats = fs.statfsSync ? fs.statfsSync(os.homedir()) : require('fs').statfsSync(os.homedir());
    ctx.disk.freeBytes = stats.bavail * stats.bsize;
    ctx.disk.totalBytes = stats.blocks * stats.bsize;
    ctx.disk.freePercent = ctx.disk.totalBytes > 0
      ? (ctx.disk.freeBytes / ctx.disk.totalBytes) * 100
      : 0;
  } catch { /* ignore */ }

  return ctx;
}

function getPowerInfo() {
  const platform = os.platform();
  const info = { onBattery: false, batteryPercent: null };
  try {
    if (platform === 'darwin') {
      const output = execSync('pmset -g ps 2>/dev/null || true', { encoding: 'utf-8', timeout: 2000 });
      info.onBattery = /Battery Power/.test(output);
      const m = output.match(/(\d+)%/);
      if (m) info.batteryPercent = parseInt(m[1], 10);
    } else if (platform === 'linux') {
      // Use upower if available, else /sys/class/power_supply.
      try {
        const capacity = fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf-8').trim();
        const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf-8').trim();
        info.batteryPercent = parseInt(capacity, 10);
        info.onBattery = status !== 'Charging' && status !== 'Full';
      } catch { /* no battery */ }
    }
  } catch { /* ignore */ }
  return info;
}

function scanResultToToolMap(scanResult) {
  const map = {};
  for (const r of scanResult.results || []) {
    map[r.id] = { size: r.total, name: r.name, risk: r.risk };
  }
  return map;
}

// ─── RULE EVALUATION ────────────────────────────────────────────────────────

/**
 * Given a set of rules and a context, return the rules that fire.
 */
function evaluate(rules, context) {
  const firing = [];
  for (const rule of rules) {
    if (!rule.when) continue;
    if (matchesWhen(rule.when, context)) {
      firing.push(rule);
    }
  }
  return firing;
}

// ─── DAEMON INSTALLATION ────────────────────────────────────────────────────

/**
 * Install the aiclean daemon on the current platform.
 * intervalMinutes determines how often rules are re-evaluated.
 */
async function installDaemon({ intervalMinutes = 15 } = {}) {
  const platform = os.platform();
  const aicleanBin = getAicleanBin();

  if (platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${DAEMON_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${aicleanBin.split(' ')[0]}</string>
${aicleanBin.split(' ').slice(1).map((a) => `      <string>${a}</string>`).join('\n')}
      <string>daemon</string>
      <string>tick</string>
    </array>
    <key>StartInterval</key><integer>${intervalMinutes * 60}</integer>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key><string>${DAEMON_LOG}</string>
    <key>StandardErrorPath</key><string>${DAEMON_LOG}</string>
  </dict>
</plist>
`;
    await fs.ensureDir(path.dirname(LAUNCHD_PATH));
    await fs.writeFile(LAUNCHD_PATH, plist);
    try {
      execSync(`launchctl unload ${JSON.stringify(LAUNCHD_PATH)} 2>/dev/null || true`);
      execSync(`launchctl load ${JSON.stringify(LAUNCHD_PATH)}`);
      return { success: true, path: LAUNCHD_PATH, backend: 'launchd' };
    } catch (err) {
      return { success: false, reason: err.message, path: LAUNCHD_PATH };
    }
  }

  if (platform === 'linux') {
    const service = `[Unit]
Description=aiclean rules engine tick
After=network.target

[Service]
Type=oneshot
ExecStart=${aicleanBin} daemon tick
StandardOutput=append:${DAEMON_LOG}
StandardError=append:${DAEMON_LOG}
`;
    const timer = `[Unit]
Description=aiclean tick every ${intervalMinutes} minutes
Requires=aiclean.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=${intervalMinutes}min

[Install]
WantedBy=timers.target
`;
    await fs.ensureDir(path.dirname(SYSTEMD_PATH));
    await fs.writeFile(SYSTEMD_PATH, service);
    await fs.writeFile(SYSTEMD_TIMER_PATH, timer);
    try {
      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable --now aiclean.timer');
      return { success: true, path: SYSTEMD_TIMER_PATH, backend: 'systemd' };
    } catch (err) {
      return { success: false, reason: err.message, path: SYSTEMD_TIMER_PATH };
    }
  }

  return { success: false, reason: 'Unsupported platform for daemon', backend: 'none' };
}

async function uninstallDaemon() {
  const platform = os.platform();
  if (platform === 'darwin') {
    try { execSync(`launchctl unload ${JSON.stringify(LAUNCHD_PATH)} 2>/dev/null || true`); } catch { /* ignore */ }
    if (await fs.pathExists(LAUNCHD_PATH)) await fs.remove(LAUNCHD_PATH);
    return { success: true };
  }
  if (platform === 'linux') {
    try { execSync('systemctl --user disable --now aiclean.timer 2>/dev/null || true'); } catch { /* ignore */ }
    if (await fs.pathExists(SYSTEMD_PATH)) await fs.remove(SYSTEMD_PATH);
    if (await fs.pathExists(SYSTEMD_TIMER_PATH)) await fs.remove(SYSTEMD_TIMER_PATH);
    return { success: true };
  }
  return { success: false, reason: 'Unsupported platform' };
}

async function daemonStatus() {
  const platform = os.platform();
  if (platform === 'darwin') {
    const installed = await fs.pathExists(LAUNCHD_PATH);
    let loaded = false;
    try {
      const output = execSync('launchctl list 2>/dev/null || true', { encoding: 'utf-8' });
      loaded = output.includes(DAEMON_LABEL);
    } catch { /* ignore */ }
    return { installed, loaded, backend: 'launchd', path: LAUNCHD_PATH, logPath: DAEMON_LOG };
  }
  if (platform === 'linux') {
    const installed = await fs.pathExists(SYSTEMD_TIMER_PATH);
    let active = false;
    try {
      const output = execSync('systemctl --user is-active aiclean.timer 2>/dev/null || true', { encoding: 'utf-8' });
      active = output.trim() === 'active';
    } catch { /* ignore */ }
    return { installed, active, backend: 'systemd', path: SYSTEMD_TIMER_PATH, logPath: DAEMON_LOG };
  }
  return { installed: false, backend: 'none' };
}

function getAicleanBin() {
  try {
    const p = execSync('which aiclean 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (p) return p;
  } catch { /* ignore */ }
  return `node ${path.resolve(__dirname, '..', 'bin', 'index.js')}`;
}

module.exports = {
  parseCondition,
  matchesWhen,
  buildContext,
  evaluate,
  installDaemon,
  uninstallDaemon,
  daemonStatus,
  DAEMON_LOG,
};
