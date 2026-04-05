const { scan } = require("./scanner");
const { clean } = require("./cleaner");
const registry = require("./registry");
const configLoader = require("../config/loader");
const telemetry = require("../telemetry/telemetry");

/**
 * Engine — orchestrates all operations.
 * Central entry point for both CLI and programmatic use.
 */
class Engine {
  constructor() {
    this.registry = registry;
    this.config = null;
  }

  /**
   * Initialize engine with config and telemetry.
   */
  async init() {
    this.config = await configLoader.load();
    telemetry.init(this.config);
    return this;
  }

  /**
   * Run a full scan.
   * @param {Object} options - { only: string[], exclude: string[], categories: string[] }
   */
  async scan(options = {}) {
    // Merge config exclusions
    const exclude = [
      ...(options.exclude || []),
      ...(this.config?.ignoredTools || []),
    ];

    const result = await scan({ ...options, exclude });

    // Track telemetry
    telemetry.trackScan(result.nonEmptyCount, result.grandTotal);

    return result;
  }

  /**
   * Run clean.
   * @param {Object} options - { dryRun: boolean, only: string[], exclude: string[] }
   */
  async clean(options = {}) {
    const exclude = [
      ...(options.exclude || []),
      ...(this.config?.ignoredTools || []),
    ];

    const result = await clean({ ...options, exclude });

    // Track telemetry
    if (!options.dryRun) {
      telemetry.trackClean(result.totalReclaimed);
    }

    return result;
  }

  /**
   * Get scan results as JSON.
   */
  async scanJSON(options = {}) {
    const result = await this.scan(options);
    return JSON.stringify(result, null, 2);
  }

  /**
   * Get all registered adapter info.
   */
  getAdapters() {
    return this.registry.getAll().map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      description: a.description,
    }));
  }

  /**
   * Get adapters grouped by category.
   */
  getAdaptersByCategory() {
    const categories = this.registry.getCategories();
    const result = {};
    for (const [cat, adapters] of categories) {
      result[cat] = adapters.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
      }));
    }
    return result;
  }

  /**
   * Get total number of supported tools.
   */
  getToolCount() {
    return this.registry.count;
  }
}

module.exports = new Engine();
