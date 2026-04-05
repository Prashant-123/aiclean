const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const API_BASE_URL = 'https://api.aiclean.tech/v1';
const AUTH_DIR = path.join(os.homedir(), '.aiclean');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

// ━━━ AUTH FILE OPERATIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Read stored auth data.
 * Returns { token, email, plan, validatedAt } or null.
 */
async function getAuth() {
  try {
    const exists = await fs.pathExists(AUTH_FILE);
    if (!exists) return null;
    const data = await fs.readJSON(AUTH_FILE);
    if (!data.token) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save auth data to disk.
 */
async function saveAuth(data) {
  await fs.ensureDir(AUTH_DIR);
  await fs.writeJSON(AUTH_FILE, data, { spaces: 2 });
}

/**
 * Get stored token.
 */
async function getToken() {
  const auth = await getAuth();
  return auth?.token || null;
}

/**
 * Check if user is authenticated.
 */
async function isAuthenticated() {
  const auth = await getAuth();
  return auth !== null && !!auth.token;
}

/**
 * Get the current plan (free, pro).
 * Returns 'free' if not authenticated or no plan stored.
 */
async function getPlan() {
  const auth = await getAuth();
  if (!auth || !auth.plan) return 'free';
  return auth.plan;
}

/**
 * Check if user has Pro plan.
 */
async function isPro() {
  const plan = await getPlan();
  return plan === 'pro';
}

// ━━━ API KEY VALIDATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Validate API key format.
 * Expected format: ak_live_xxxxx or ak_test_xxxxx (32+ chars)
 */
function validateKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, reason: 'API key is required' };
  }

  const trimmed = apiKey.trim();

  if (trimmed.length < 20) {
    return { valid: false, reason: 'API key is too short' };
  }

  if (!/^ak_(live|test)_[a-zA-Z0-9]+$/.test(trimmed)) {
    return { valid: false, reason: 'Invalid format. Expected: ak_live_xxxxx or ak_test_xxxxx' };
  }

  return { valid: true, key: trimmed };
}

/**
 * Validate email format.
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'Email is required' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { valid: false, reason: 'Invalid email format' };
  }
  return { valid: true, email: email.trim() };
}

// ━━━ LOGIN / LOGOUT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Login with API key.
 * Verifies against the server. Falls back to local storage if server is unreachable.
 */
async function login(apiKey, email) {
  // Validate inputs
  const keyCheck = validateKeyFormat(apiKey);
  if (!keyCheck.valid) {
    return { success: false, message: keyCheck.reason };
  }

  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) {
    return { success: false, message: emailCheck.reason };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyCheck.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: emailCheck.email }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();
      await saveAuth({
        token: keyCheck.key,
        email: emailCheck.email,
        plan: data.plan || 'pro',
        validatedAt: new Date().toISOString(),
        expiresAt: data.expiresAt || null,
        source: 'server',
      });
      return {
        success: true,
        plan: data.plan || 'pro',
        message: `Authenticated as ${emailCheck.email} (${data.plan || 'pro'} plan)`,
      };
    }

    if (response.status === 401) {
      return { success: false, message: 'Invalid API key. Check your key at aiclean.tech/settings.' };
    }
    if (response.status === 403) {
      return { success: false, message: 'API key expired or revoked. Generate a new one at aiclean.tech/settings.' };
    }

    return { success: false, message: `Server error (${response.status}). Try again later.` };
  } catch (err) {
    // Server unreachable — determine plan from key prefix
    const plan = keyCheck.key.startsWith('ak_live_') ? 'pro' : 'free';

    await saveAuth({
      token: keyCheck.key,
      email: emailCheck.email,
      plan,
      validatedAt: new Date().toISOString(),
      expiresAt: null,
      source: 'offline',
    });

    return {
      success: true,
      plan,
      message: `Saved locally (server offline). Plan: ${plan}. Will verify on next login.`,
    };
  }
}

/**
 * Logout — remove stored credentials.
 */
async function logout() {
  try {
    const auth = await getAuth();
    await fs.remove(AUTH_FILE);
    return {
      success: true,
      message: auth ? `Logged out ${auth.email}. Credentials removed.` : 'Already logged out.',
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ━━━ PLAN INFO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get full account status.
 */
async function getAccountStatus() {
  const auth = await getAuth();
  if (!auth) {
    return {
      authenticated: false,
      plan: 'free',
      email: null,
      message: 'Not logged in. Using free plan.',
    };
  }

  return {
    authenticated: true,
    plan: auth.plan || 'free',
    email: auth.email,
    validatedAt: auth.validatedAt,
    source: auth.source,
    message: `Logged in as ${auth.email} (${auth.plan} plan)`,
  };
}

module.exports = {
  getAuth,
  getToken,
  isAuthenticated,
  getPlan,
  isPro,
  validateKeyFormat,
  validateEmail,
  login,
  logout,
  getAccountStatus,
  saveAuth,
  API_BASE_URL,
  AUTH_FILE,
};
