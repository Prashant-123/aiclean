const fs = require("fs-extra");
const path = require("path");
const os = require("os");

const CONFIG_DIR = path.join(os.homedir(), ".aiclean");
const RC_FILE = path.join(os.homedir(), ".aicleanrc");
const DEFAULT_CONFIG = require("./default.json");

/**
 * Config loader — merges defaults with user's ~/.aicleanrc.
 * Fully functional config persistence system.
 */

/**
 * Ensure config directory exists.
 */
async function ensureConfigDir() {
  await fs.ensureDir(CONFIG_DIR);
}

/**
 * Load config, merging defaults with user overrides.
 */
async function load() {
  let userConfig = {};

  try {
    const exists = await fs.pathExists(RC_FILE);
    if (exists) {
      const content = await fs.readFile(RC_FILE, "utf-8");
      userConfig = JSON.parse(content);
    }
  } catch {
    // Invalid config — use defaults
  }

  return deepMerge(DEFAULT_CONFIG, userConfig);
}

/**
 * Save config to ~/.aicleanrc.
 */
async function save(config) {
  await ensureConfigDir();
  const merged = deepMerge(DEFAULT_CONFIG, config);
  await fs.writeFile(RC_FILE, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

/**
 * Get a specific config value (supports dot notation).
 */
async function get(key) {
  const config = await load();
  return key.split(".").reduce((obj, k) => obj?.[k], config);
}

/**
 * Set a specific config value (supports dot notation).
 */
async function set(key, value) {
  const config = await load();
  const keys = key.split(".");
  let obj = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  return save(config);
}

/**
 * Reset config to defaults.
 */
async function reset() {
  return save(DEFAULT_CONFIG);
}

/**
 * Deep merge two objects.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = {
  load,
  save,
  get,
  set,
  reset,
  RC_FILE,
  CONFIG_DIR,
  ensureConfigDir,
};
