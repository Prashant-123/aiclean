const chalk = require('chalk');
const apiClient = require('../api/client');

/**
 * Pro-only features that require authentication + pro plan.
 */
const PRO_FEATURES = [
  'auto',        // scheduled auto-clean setup
];

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

  // Re-verify with the server to catch expired/cancelled subscriptions
  const currentPlan = await apiClient.refreshPlan();

  if (currentPlan !== 'pro') {
    return {
      allowed: false,
      reason: 'free_plan',
      message: 'This feature requires the Pro plan ($5/month).',
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
    console.log(chalk.red('  This feature requires a Pro subscription.'));
    console.log();
    console.log(chalk.bold('  To get started:'));
    console.log(chalk.dim('    1. Purchase at ') + chalk.underline('https://aiclean.tech/pricing'));
    console.log(chalk.dim('    2. Run: ') + chalk.bold('aiclean login') + chalk.dim(' with the license key from your email'));
  } else {
    // free_plan
    console.log(chalk.red(`  "${featureName}" is a Pro feature.`));
    console.log();
    console.log(chalk.dim('  Your current plan: ') + chalk.bold('Free'));
    console.log(chalk.dim('  Upgrade to Pro ($5/month) at ') + chalk.underline('https://aiclean.tech/pricing'));
  }

  console.log();
  process.exit(1);
}

module.exports = { checkPro, requirePro, PRO_FEATURES };
