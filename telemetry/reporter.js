/**
 * Fleet agent reporter (Pro/Team feature).
 *
 * When installed, periodically reports device metrics (scan totals, clean
 * totals, disk state, tool breakdowns) to the backend at
 * https://api.aiclean.tech/v1/fleet/*. These feed the fleet dashboard and
 * the cross-machine benchmark feature.
 *
 * PRIVACY PROMISE:
 *   - We NEVER send file paths, filenames, or user content.
 *   - We only send per-tool aggregate sizes + counts + hostname hash.
 *   - Opt-in only; nothing is sent unless `aiclean agent install` was run.
 *
 * The reporter runs piggyback on the `daemon tick` cycle (same interval).
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const apiClient = require('../api/client');

const AGENT_DIR = path.join(os.homedir(), '.aiclean', 'agent');
const AGENT_CONFIG = path.join(AGENT_DIR, 'config.json');
const AGENT_LOG = path.join(AGENT_DIR, 'agent.log');
const API_BASE = process.env.AICLEAN_API_BASE || 'https://api.aiclean.tech/v1';

// ─── DEVICE IDENTITY ────────────────────────────────────────────────────────

/**
 * A stable per-device identifier the user can reset but never leaks PII.
 * Hash of (os.hostname + homedir), first 16 hex chars.
 */
function computeDeviceId() {
  const raw = os.hostname() + ':' + os.homedir();
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

async function readConfig() {
  if (!(await fs.pathExists(AGENT_CONFIG))) return null;
  try {
    return await fs.readJSON(AGENT_CONFIG);
  } catch {
    return null;
  }
}

async function writeConfig(cfg) {
  await fs.ensureDir(AGENT_DIR);
  await fs.writeJSON(AGENT_CONFIG, cfg, { spaces: 2 });
}

// ─── ENROLL ─────────────────────────────────────────────────────────────────

/**
 * Enroll this device with the backend. Requires user to be logged in (Pro).
 * Accepts an optional orgToken for Team-tier enrollment.
 */
async function enroll({ orgToken } = {}) {
  const token = await apiClient.getToken();
  if (!token) {
    return { success: false, reason: 'not logged in' };
  }

  const body = {
    deviceId: computeDeviceId(),
    hostnameHash: createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12),
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    cliVersion: require('../package.json').version,
    orgToken: orgToken || null,
  };

  try {
    const res = await fetch(`${API_BASE}/fleet/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { success: false, reason: `Server responded ${res.status}` };
    }
    const data = await res.json();
    await writeConfig({
      enrolledAt: new Date().toISOString(),
      deviceId: body.deviceId,
      deviceToken: data.deviceToken || null,
      orgId: data.orgId || null,
    });
    return { success: true, deviceId: body.deviceId, orgId: data.orgId };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function unenroll() {
  const cfg = await readConfig();
  if (!cfg) return { success: true };
  const token = await apiClient.getToken();
  try {
    if (token) {
      await fetch(`${API_BASE}/fleet/device/${cfg.deviceId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    }
  } catch { /* ignore */ }
  await fs.remove(AGENT_CONFIG);
  return { success: true };
}

// ─── HEARTBEAT ──────────────────────────────────────────────────────────────

/**
 * Send a heartbeat with scan + disk state. Safe to call on every tick.
 */
async function heartbeat({ scanResult, diskInfo } = {}) {
  const cfg = await readConfig();
  if (!cfg) return { skipped: true, reason: 'not enrolled' };

  const token = await apiClient.getToken();
  if (!token) return { skipped: true, reason: 'not logged in' };

  const payload = {
    deviceId: cfg.deviceId,
    at: new Date().toISOString(),
    disk: diskInfo || null,
    tools: scanResult
      ? (scanResult.results || []).map((r) => ({
          id: r.id,
          category: r.category,
          sizeBytes: r.total,
        }))
      : [],
    totalReclaimable: scanResult?.grandTotal || 0,
  };

  try {
    const res = await fetch(`${API_BASE}/fleet/heartbeat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return { success: res.ok, status: res.status };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

// ─── BENCHMARK QUERY ────────────────────────────────────────────────────────

/**
 * Fetch cross-machine benchmarks for the current device's tools.
 * Returns { toolId: { p50, p90, p99, n } }.
 */
async function fetchBenchmarks() {
  const token = await apiClient.getToken();
  if (!token) return { success: false, reason: 'not logged in' };

  try {
    const res = await fetch(`${API_BASE}/fleet/benchmarks`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Platform': os.platform(),
        'X-Arch': os.arch(),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, reason: `Server responded ${res.status}` };
    return { success: true, benchmarks: await res.json() };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function agentStatus() {
  const cfg = await readConfig();
  if (!cfg) return { enrolled: false };
  return {
    enrolled: true,
    enrolledAt: cfg.enrolledAt,
    deviceId: cfg.deviceId,
    orgId: cfg.orgId,
  };
}

module.exports = {
  computeDeviceId,
  enroll,
  unenroll,
  heartbeat,
  fetchBenchmarks,
  agentStatus,
  AGENT_DIR,
  AGENT_LOG,
};
