const registry = require("./registry");
const { formatSize } = require("../utils/size");

/**
 * Scanner — runs size analysis across adapters.
 * Supports filtering by tool IDs, categories, and exclusions.
 */
async function scan(options = {}) {
  const { only, exclude = [], categories: filterCategories } = options;

  let adapters;
  if (only && only.length > 0) {
    adapters = registry.getOnly(only);
  } else if (filterCategories && filterCategories.length > 0) {
    adapters = [];
    for (const cat of filterCategories) {
      adapters.push(...registry.getByCategory(cat));
    }
  } else {
    adapters = registry.getAll();
  }

  // Apply exclusions
  if (exclude.length > 0) {
    adapters = adapters.filter((a) => !exclude.includes(a.id));
  }

  const results = [];
  let grandTotal = 0;

  // Scan all adapters in parallel
  const scanPromises = adapters.map(async (adapter) => {
    try {
      return await adapter.getSize();
    } catch (err) {
      return {
        id: adapter.id,
        name: adapter.name,
        category: adapter.category,
        total: 0,
        formatted: "0 B",
        categories: [],
        error: err.message,
      };
    }
  });

  const sizeResults = await Promise.all(scanPromises);

  for (const sizeInfo of sizeResults) {
    grandTotal += sizeInfo.total;
    results.push(sizeInfo);
  }

  // Sort by size descending
  results.sort((a, b) => b.total - a.total);

  // Generate insights
  const insights = generateInsights(results);

  return {
    results,
    grandTotal,
    grandTotalFormatted: formatSize(grandTotal),
    toolCount: results.length,
    nonEmptyCount: results.filter((r) => r.total > 0).length,
    insights,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Insights engine — flags notable findings.
 */
function generateInsights(results) {
  const insights = [];
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;

  const nonEmpty = results.filter((r) => r.total > 0);

  for (const result of nonEmpty) {
    if (result.total > 10 * GB) {
      insights.push({
        level: "critical",
        tool: result.name,
        message: `${result.name} is using ${result.formatted} — consider immediate cleanup`,
      });
    } else if (result.total > 5 * GB) {
      insights.push({
        level: "warning",
        tool: result.name,
        message: `${result.name} is unusually large (${result.formatted})`,
      });
    } else if (result.total > 1 * GB) {
      insights.push({
        level: "info",
        tool: result.name,
        message: `${result.name} is using ${result.formatted}`,
      });
    }
  }

  // Category rollup insights
  const categoryTotals = new Map();
  for (const r of nonEmpty) {
    const cat = r.category || "Unknown";
    categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + r.total);
  }

  for (const [cat, total] of categoryTotals) {
    if (total > 20 * GB) {
      insights.push({
        level: "critical",
        tool: cat,
        message: `${cat} category is using ${formatSize(total)} total`,
      });
    }
  }

  // Top space hog
  if (nonEmpty.length > 0 && nonEmpty[0].total > 500 * MB) {
    const top = nonEmpty[0];
    const pct = results.reduce((s, r) => s + r.total, 0);
    if (pct > 0) {
      const topPct = ((top.total / pct) * 100).toFixed(0);
      insights.push({
        level: "info",
        tool: top.name,
        message: `${top.name} accounts for ${topPct}% of total reclaimable space`,
      });
    }
  }

  return insights;
}

module.exports = { scan };
