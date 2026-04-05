const os = require("os");
const path = require("path");

const HOME = os.homedir();
const PLATFORM = os.platform(); // 'darwin', 'linux', 'win32'

/**
 * Resolve ~ and platform-aware paths.
 */
function resolvePath(p) {
  if (p.startsWith("~/")) {
    return path.join(HOME, p.slice(2));
  }
  if (p.startsWith("~")) {
    return path.join(HOME, p.slice(1));
  }
  return p;
}

/**
 * Check if running on macOS.
 */
function isMac() {
  return PLATFORM === "darwin";
}

/**
 * Check if running on Linux.
 */
function isLinux() {
  return PLATFORM === "linux";
}

/**
 * Get JetBrains product directories matching a pattern.
 * JetBrains uses versioned dirs like IntelliJIdea2025.1, PyCharm2024.3, etc.
 */
async function getJetBrainsProductDirs(basePath, productPrefix) {
  const fs = require("fs-extra");
  const resolved = resolvePath(basePath);
  try {
    const exists = await fs.pathExists(resolved);
    if (!exists) return [];
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith(productPrefix))
      .map((e) => path.join(resolved, e.name));
  } catch {
    return [];
  }
}

/**
 * Get all JetBrains IDE cache directories.
 */
async function getAllJetBrainsCacheDirs() {
  const products = [
    "IntelliJIdea",
    "PyCharm",
    "WebStorm",
    "PhpStorm",
    "RubyMine",
    "GoLand",
    "CLion",
    "DataGrip",
    "Rider",
    "AndroidStudio",
    "AppCode",
    "DataSpell",
    "RustRover",
    "Aqua",
  ];

  const dirs = [];
  const basePath = isMac()
    ? "~/Library/Caches/JetBrains"
    : "~/.cache/JetBrains";

  for (const product of products) {
    const found = await getJetBrainsProductDirs(basePath, product);
    dirs.push(...found);
  }

  return dirs;
}

/**
 * Get all JetBrains IDE log directories.
 */
async function getAllJetBrainsLogDirs() {
  const products = [
    "IntelliJIdea",
    "PyCharm",
    "WebStorm",
    "PhpStorm",
    "RubyMine",
    "GoLand",
    "CLion",
    "DataGrip",
    "Rider",
    "AndroidStudio",
    "AppCode",
    "DataSpell",
    "RustRover",
    "Aqua",
  ];

  const dirs = [];
  const basePath = isMac()
    ? "~/Library/Logs/JetBrains"
    : "~/.local/share/JetBrains"; // Linux logs are mixed in

  for (const product of products) {
    const found = await getJetBrainsProductDirs(basePath, product);
    dirs.push(...found);
  }

  return dirs;
}

module.exports = {
  HOME,
  PLATFORM,
  resolvePath,
  isMac,
  isLinux,
  getJetBrainsProductDirs,
  getAllJetBrainsCacheDirs,
  getAllJetBrainsLogDirs,
};
