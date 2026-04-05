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

  if (status.plan !== 'pro') {
    return {
      allowed: false,
      reason: 'free_plan',
      message: 'This feature requires the Pro plan ($5/month).',
    };
  }

  return { allowed: true, email: status.email, plan: status.plan };
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
    console.log(chalk.dim('    1. Subscribe at ') + chalk.underline('https://aiclean.tech/pricing'));
    console.log(chalk.dim('    2. Get your API key from ') + chalk.underline('https://aiclean.tech/settings'));
    console.log(chalk.dim('    3. Run: ') + chalk.bold('aiclean login'));
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
