const chalk = require('chalk');
const apiClient = require('../api/client');

/**
 * Pro-only features. Listed here so we can reference them in one place
 * and surface a helpful table in `aiclean plan --features` later.
 */
const PRO_FEATURES = {
  'auto': 'Scheduled auto-clean via the aiclean daemon + rules engine',
  'age-based cleaning (--older-than)': 'Only clean files above a given age',
  'rollback / snapshots (aiclean restore)': 'Create restore points before cleaning, roll back with one command',
  'pre-flight disk guardian (aiclean guard)': 'Intercept ollama/huggingface/docker/pip/npm downloads when disk is tight',
  'duplicate model detection (aiclean dedupe)': 'Find and hardlink duplicate ML weights across tools',
  'project-aware cleaning (aiclean projects)': 'Reclaim node_modules/target/.venv from dormant git repos',
  'smart rules engine (aiclean rules)': 'Condition-based automation (disk %, idle time, project mtime, ...)',
  'live adapter registry (aiclean registry)': 'Signed, daily-updated tool definitions with bloat advisories',
  'fleet / team dashboard (aiclean agent)': 'Report device metrics to a hosted dashboard for org-wide visibility',
  'benchmarks (aiclean benchmark)': 'Compare your usage against anonymized aggregates from other devs',
};

const PRO_FEATURE_IDS = Object.keys(PRO_FEATURES);

/**
 * Check if the current user has Pro access.
 * Re-verifies the license key with the server to catch expired subscriptions.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
async function checkPro() {
  const status = await apiClient.getAccountStatus();

  if (!status.authenticated) {
    return {
      allowed: false,
      reason: 'not_logged_in',
      message: 'You need to be logged in to use this feature.',
    };
  }

  // Re-verify with the server to catch expired/cancelled subscriptions.
  // Falls back to cached plan if the server is unreachable.
  const currentPlan = await apiClient.refreshPlan();

  if (currentPlan !== 'pro') {
    return {
      allowed: false,
      reason: 'free_plan',
      message: 'This feature requires the Pro plan.',
    };
  }

  return { allowed: true, email: status.email, plan: currentPlan };
}

/**
 * Require Pro plan. Prints error and exits if not Pro.
 * Use at the start of any Pro-only command action.
 */
async function requirePro(featureName) {
  const check = await checkPro();

  if (check.allowed) return true;

  console.log();

  if (check.reason === 'not_logged_in') {
    console.log(chalk.red(`  "${featureName}" is a Pro feature.`));
    console.log();
    console.log(chalk.bold('  To get started:'));
    console.log(chalk.dim('    1. Purchase at ') + chalk.underline('https://aiclean.tech/pricing'));
    console.log(chalk.dim('    2. Run: ') + chalk.bold('aiclean login') + chalk.dim(' with the license key from your email'));
  } else {
    console.log(chalk.red(`  "${featureName}" is a Pro feature.`));
    console.log();
    console.log(chalk.dim('  Your current plan: ') + chalk.bold('Free'));
    console.log(chalk.dim('  Upgrade to Pro at ') + chalk.underline('https://aiclean.tech/pricing'));
  }

  console.log();
  process.exit(1);
}

module.exports = { checkPro, requirePro, PRO_FEATURES, PRO_FEATURE_IDS };
