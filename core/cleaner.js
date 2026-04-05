const registry = require("./registry");
const { formatSize } = require("../utils/size");
const logger = require("../utils/logger");

/**
 * Cleaner — executes clean operations.
 * Supports filtering by tool IDs, categories, and exclusions.
 */
async function clean(options = {}) {
  const { dryRun = false, only, exclude = [], olderThan } = options;

  let adapters;
  if (only && only.length > 0) {
    adapters = registry.getOnly(only);
  } else {
    adapters = registry.getAll();
  }

  // Apply exclusions
  if (exclude.length > 0) {
    adapters = adapters.filter((a) => !exclude.includes(a.id));
  }

  const allResults = [];
  let totalReclaimed = 0;
  let errorCount = 0;

  for (const adapter of adapters) {
    try {
      const results = await adapter.clean(dryRun, olderThan);

      for (const result of results) {
        totalReclaimed += result.size;
        if (result.action === "error") errorCount++;
        allResults.push({
          tool: adapter.name,
          toolId: adapter.id,
          category: adapter.category,
          ...result,
        });
      }

      // Log clean operations
      if (!dryRun && results.length > 0) {
        const adapterTotal = results.reduce((sum, r) => sum + r.size, 0);
        await logger.logClean({
          tool: adapter.name,
          toolId: adapter.id,
          paths: results.map((r) => r.path),
          bytesReclaimed: adapterTotal,
        });
      }
    } catch (err) {
      allResults.push({
        tool: adapter.name,
        toolId: adapter.id,
        category: adapter.category,
        path: "N/A",
        size: 0,
        formatted: "0 B",
        action: "error",
        error: err.message,
      });
      errorCount++;
    }
  }

  // Log summary
  if (!dryRun && totalReclaimed > 0) {
    await logger.info("Clean completed", {
      totalReclaimed,
      totalReclaimedFormatted: formatSize(totalReclaimed),
      toolsCleaned: allResults.filter((r) => r.action === "cleaned").length,
      errors: errorCount,
    });
  }

  return {
    results: allResults,
    totalReclaimed,
    totalReclaimedFormatted: formatSize(totalReclaimed),
    dryRun,
    errorCount,
    cleanedAt: new Date().toISOString(),
  };
}

module.exports = { clean };
