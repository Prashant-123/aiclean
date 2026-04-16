/**
 * Signed adapter registry fetcher (Pro feature).
 *
 * The free CLI ships with adapters baked into `adapters/definitions/*.js`.
 * Pro users can also fetch a signed, daily-updated manifest from the server
 * that may contain:
 *   - New tools (faster turnaround than npm releases)
 *   - Path corrections for new tool versions ("Cursor 0.41 moved cache")
 *   - Bloat advisories ("Ollama 0.5.x leaks partial downloads — now cleaned")
 *
 * Verification: Ed25519 signature using a single public key baked into the
 * CLI at build time (see utils/signing-key.js). If the signature fails or
 * the manifest is stale, we silently fall back to baked-in definitions so
 * the CLI never breaks because of a server issue.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const ed25519 = require('@noble/ed25519');
const { sha512 } = require('@noble/hashes/sha512');
const { sha256 } = require('@noble/hashes/sha256');

// @noble/ed25519 requires a sha512 shim (Node's crypto has it but noble wants it explicit)
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

const REGISTRY_DIR = path.join(os.homedir(), '.aiclean', 'registry');
const MANIFEST_FILE = path.join(REGISTRY_DIR, 'manifest.json');
const SIG_FILE = path.join(REGISTRY_DIR, 'manifest.sig');
const META_FILE = path.join(REGISTRY_DIR, 'meta.json');

// Baked-in public key. The matching private key lives offline.
// Replace this constant at release time; it's a 32-byte Ed25519 public key in hex.
// Format: 64 hex chars. Dummy key here — replace before v2 release.
const PUBLIC_KEY_HEX =
  process.env.AICLEAN_REGISTRY_PUBKEY ||
  '0000000000000000000000000000000000000000000000000000000000000000';

const API_BASE = process.env.AICLEAN_API_BASE || 'https://api.aiclean.tech/v1';
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── HEX HELPERS ────────────────────────────────────────────────────────────

function hexToBytes(hex) {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error('Odd-length hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── FETCH ──────────────────────────────────────────────────────────────────

/**
 * Fetch the latest signed manifest from the API.
 * Returns { success: true, manifest, fetchedAt } or { success: false, reason }.
 */
async function fetchLatest({ token } = {}) {
  try {
    const headers = { 'User-Agent': 'aiclean-cli' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${API_BASE}/registry/latest`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, reason: `Server responded ${response.status}` };
    }

    const body = await response.json();
    if (!body.manifest || !body.signature) {
      return { success: false, reason: 'Invalid response shape (expected { manifest, signature })' };
    }

    return { success: true, raw: body };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

// ─── VERIFY ─────────────────────────────────────────────────────────────────

/**
 * Verify manifest signature using the baked-in public key.
 * The signed payload is the canonical JSON of the manifest.
 */
function verify(manifest, signatureHex) {
  if (PUBLIC_KEY_HEX === '0'.repeat(64)) {
    // Dev mode / unreleased build — reject all signatures, caller will fall back.
    return { valid: false, reason: 'CLI was built without a registry public key' };
  }

  try {
    const pub = hexToBytes(PUBLIC_KEY_HEX);
    const sig = hexToBytes(signatureHex);
    const message = new TextEncoder().encode(canonicalJSON(manifest));
    const valid = ed25519.verify(sig, message, pub);
    return valid
      ? { valid: true }
      : { valid: false, reason: 'Signature did not verify' };
  } catch (err) {
    return { valid: false, reason: `Verify error: ${err.message}` };
  }
}

/**
 * Canonical JSON stringification. Keys sorted recursively so signer and verifier
 * always hash the same bytes regardless of insertion order.
 */
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

// ─── STORE ──────────────────────────────────────────────────────────────────

async function storeManifest(manifest, signatureHex) {
  await fs.ensureDir(REGISTRY_DIR);
  await fs.writeJSON(MANIFEST_FILE, manifest, { spaces: 2 });
  await fs.writeFile(SIG_FILE, signatureHex);
  await fs.writeJSON(META_FILE, {
    fetchedAt: new Date().toISOString(),
    version: manifest.version,
    definitionCount: (manifest.definitions || []).length,
    hash: bytesToHex(sha256(canonicalJSON(manifest))),
  }, { spaces: 2 });
}

/**
 * Load the locally cached manifest, verifying it hasn't been tampered with.
 * Returns { manifest, meta } or null if none / invalid.
 */
async function loadCached() {
  try {
    if (!(await fs.pathExists(MANIFEST_FILE))) return null;
    if (!(await fs.pathExists(SIG_FILE))) return null;

    const manifest = await fs.readJSON(MANIFEST_FILE);
    const signatureHex = (await fs.readFile(SIG_FILE, 'utf-8')).trim();
    const check = verify(manifest, signatureHex);
    if (!check.valid) {
      // Tampered cache — wipe it.
      await fs.remove(MANIFEST_FILE);
      await fs.remove(SIG_FILE);
      await fs.remove(META_FILE).catch(() => {});
      return null;
    }

    const meta = (await fs.pathExists(META_FILE)) ? await fs.readJSON(META_FILE) : {};
    return { manifest, meta };
  } catch {
    return null;
  }
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Refresh the registry. Fetches + verifies + stores. Pro-gated by caller.
 */
async function refresh({ token } = {}) {
  const fetched = await fetchLatest({ token });
  if (!fetched.success) {
    return { success: false, reason: fetched.reason, source: 'network' };
  }

  const { manifest, signature } = fetched.raw;
  const check = verify(manifest, signature);
  if (!check.valid) {
    return { success: false, reason: check.reason, source: 'signature' };
  }

  await storeManifest(manifest, signature);

  return {
    success: true,
    version: manifest.version,
    definitionCount: (manifest.definitions || []).length,
    advisoryCount: (manifest.advisories || []).length,
    signedAt: manifest.signedAt,
  };
}

/**
 * Return current registry status.
 */
async function status() {
  const cached = await loadCached();
  if (!cached) {
    return { installed: false, usingBakedIn: true };
  }
  const age = Date.now() - new Date(cached.meta.fetchedAt || 0).getTime();
  return {
    installed: true,
    version: cached.manifest.version,
    fetchedAt: cached.meta.fetchedAt,
    ageDays: Math.floor(age / (24 * 60 * 60 * 1000)),
    stale: age > STALE_THRESHOLD_MS,
    definitionCount: (cached.manifest.definitions || []).length,
    advisoryCount: (cached.manifest.advisories || []).length,
    publicKey: PUBLIC_KEY_HEX,
    usingBakedIn: false,
  };
}

/**
 * Merge cached manifest definitions with baked-in ones.
 * Caller (core/registry.js) decides policy: baked-in are the floor; manifest
 * adds new tools or overrides paths for existing ones.
 */
async function getLiveDefinitions() {
  const cached = await loadCached();
  if (!cached) return { definitions: [], advisories: [] };
  return {
    definitions: cached.manifest.definitions || [],
    advisories: cached.manifest.advisories || [],
    version: cached.manifest.version,
  };
}

/**
 * Clear cached registry (for debugging / logout).
 */
async function clear() {
  await fs.remove(REGISTRY_DIR);
}

module.exports = {
  refresh,
  status,
  loadCached,
  getLiveDefinitions,
  clear,
  verify,
  canonicalJSON,
  PUBLIC_KEY_HEX,
  REGISTRY_DIR,
};
