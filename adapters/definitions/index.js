/**
 * Central index of all tool definitions.
 * Organized by category for easy navigation.
 */

const aiTools = require("./ai-tools");
const editors = require("./editors");
const packageManagers = require("./package-managers");
const languages = require("./languages");
const buildTools = require("./build-tools");
const cloudDevops = require("./cloud-devops");
const mlFrameworks = require("./ml-frameworks");
const system = require("./system");

// All definitions in a flat array
const allDefinitions = [
  ...aiTools,
  ...editors,
  ...packageManagers,
  ...languages,
  ...buildTools,
  ...cloudDevops,
  ...mlFrameworks,
  ...system,
];

// Category map for grouped display
const categories = {
  "AI Tools": aiTools,
  Editors: editors,
  "Package Managers": packageManagers,
  Languages: languages,
  "Build Tools": buildTools,
  "Cloud & DevOps": cloudDevops,
  "ML Frameworks": mlFrameworks,
  System: system,
};

/**
 * Get all definitions.
 */
function getAll() {
  return allDefinitions;
}

/**
 * Get definitions by category name.
 */
function getByCategory(categoryName) {
  return categories[categoryName] || [];
}

/**
 * Get a single definition by ID.
 */
function getById(id) {
  return allDefinitions.find((d) => d.id === id) || null;
}

/**
 * Get all category names.
 */
function getCategoryNames() {
  return Object.keys(categories);
}

/**
 * Get total count of tools.
 */
function getCount() {
  return allDefinitions.length;
}

module.exports = {
  getAll,
  getByCategory,
  getById,
  getCategoryNames,
  getCount,
  categories,
};
