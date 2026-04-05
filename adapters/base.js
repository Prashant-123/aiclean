const fs = require('fs-extra');
const { getDirSize, getDirSizeFiltered, formatSize, cleanDirFiltered } = require('../utils/size');
const { resolvePath, PLATFORM } = require('../utils/platform');

/**
 * Create an adapter from a tool definition.
 *
 * Definition must include:
 *   id, name, category, description, risk, riskReason, processNames, paths
 */
function createAdapter(definition) {
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    description: definition.description,
    risk: definition.risk || 'low',
    riskReason: definition.riskReason || '',
    processNames: definition.processNames || [],

    /**
     * Get resolved paths for current platform.
     */
    async getPaths() {
      const platformPaths = definition.paths[PLATFORM] || [];
      const resolved = platformPaths.map((p) => ({
        name: p.name,
        path: resolvePath(p.path),
      }));

      if (definition.dynamicPaths) {
        const dynamic = await definition.dynamicPaths();
        resolved.push(...dynamic);
      }

      return resolved;
    },

    /**
     * Get size breakdown by category.
     */
    async getSize(olderThan) {
      const paths = await this.getPaths();
      // Deduplicate overlapping paths (child inside parent)
      const dedupedPaths = deduplicatePaths(paths);
      let total = 0;
      const categories = [];

      for (const entry of dedupedPaths) {
        let size = 0;
        try {
          size = olderThan
            ? await getDirSizeFiltered(entry.path, olderThan)
            : await getDirSize(entry.path);
        } catch {
          // Skip inaccessible paths
        }
        total += size;
        if (size > 0) {
          categories.push({
            name: entry.name,
            path: entry.path,
            size,
            formatted: formatSize(size),
          });
        }
      }

      return {
        id: this.id,
        name: this.name,
        category: this.category,
        risk: this.risk,
        riskReason: this.riskReason,
        total,
        formatted: formatSize(total),
        categories,
      };
    },

    /**
     * Clean all paths.
     */
    async clean(dryRun = false, olderThan) {
      const paths = await this.getPaths();
      const dedupedPaths = deduplicatePaths(paths);
      const results = [];

      for (const entry of dedupedPaths) {
        const exists = await fs.pathExists(entry.path);
        if (!exists) continue;

        const size = olderThan
          ? await getDirSizeFiltered(entry.path, olderThan)
          : await getDirSize(entry.path);
        if (size === 0) continue;

        if (dryRun) {
          results.push({
            path: entry.path,
            name: entry.name,
            size,
            formatted: formatSize(size),
            action: 'would delete',
          });
        } else {
          try {
            if (olderThan) {
              await cleanDirFiltered(entry.path, olderThan);
            } else {
              await fs.emptyDir(entry.path);
            }
            results.push({
              path: entry.path,
              name: entry.name,
              size,
              formatted: formatSize(size),
              action: 'cleaned',
            });
          } catch (err) {
            results.push({
              path: entry.path,
              name: entry.name,
              size,
              formatted: formatSize(size),
              action: 'error',
              error: err.message,
            });
          }
        }
      }

      return results;
    },
  };
}

/**
 * Remove child paths that are subdirectories of other paths in the list.
 * Prevents double-counting when both a parent and child are listed.
 */
function deduplicatePaths(paths) {
  const sorted = [...paths].sort((a, b) => a.path.length - b.path.length);
  const result = [];

  for (const entry of sorted) {
    const isChild = result.some((parent) => {
      const parentPath = parent.path.endsWith('/') ? parent.path : parent.path + '/';
      return entry.path.startsWith(parentPath);
    });
    if (!isChild) {
      result.push(entry);
    }
  }

  return result;
}

module.exports = { createAdapter };
