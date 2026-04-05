const { createAdapter } = require("../adapters/base");
const definitions = require("../adapters/definitions");

/**
 * Tool Registry — manages all tool adapters.
 * Auto-populates from definitions on load.
 */
class Registry {
  constructor() {
    this.adapters = new Map();
    this._initialized = false;
  }

  /**
   * Initialize registry with all definitions.
   */
  init() {
    if (this._initialized) return;

    const allDefs = definitions.getAll();
    for (const def of allDefs) {
      const adapter = createAdapter(def);
      this.adapters.set(adapter.id, adapter);
    }
    this._initialized = true;
  }

  /**
   * Register a custom adapter (for plugins).
   */
  register(adapter) {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Get adapter by id.
   */
  get(id) {
    return this.adapters.get(id);
  }

  /**
   * Get all registered adapters.
   */
  getAll() {
    return Array.from(this.adapters.values());
  }

  /**
   * Get adapters filtered by category.
   */
  getByCategory(category) {
    return this.getAll().filter((a) => a.category === category);
  }

  /**
   * Get adapters excluding specific IDs.
   */
  getExcluding(excludeIds = []) {
    return this.getAll().filter((a) => !excludeIds.includes(a.id));
  }

  /**
   * Get adapters for specific IDs only.
   */
  getOnly(ids = []) {
    return ids.map((id) => this.adapters.get(id)).filter(Boolean);
  }

  /**
   * Get all adapter IDs.
   */
  getIds() {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all categories.
   */
  getCategories() {
    const cats = new Map();
    for (const adapter of this.getAll()) {
      if (!cats.has(adapter.category)) {
        cats.set(adapter.category, []);
      }
      cats.get(adapter.category).push(adapter);
    }
    return cats;
  }

  /**
   * Check if an adapter is registered.
   */
  has(id) {
    return this.adapters.has(id);
  }

  /**
   * Get total count of registered adapters.
   */
  get count() {
    return this.adapters.size;
  }
}

// Singleton
const registry = new Registry();
registry.init();

module.exports = registry;
