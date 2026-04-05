#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const engine = require('../core/engine');
const { formatSize, parseDuration } = require('../utils/size');
const telemetry = require('../telemetry/telemetry');
const configLoader = require('../config/loader');
const logger = require('../utils/logger');
const apiClient = require('../api/client');
const definitions = require('../adapters/definitions');
const safety = require('../utils/safety');
const { requirePro } = require('../utils/auth');
const pkg = require('../package.json');

const RISK_ICONS = {
  low: chalk.green('LOW'),
  medium: chalk.yellow('MED'),
  high: chalk.red('HIGH'),
};

program
  .name('aiclean')
  .description(`Scan and clean disk usage from ${definitions.getCount()}+ dev tools`)
  .version(pkg.version);

// ━━━ SCAN COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('scan')
  .description('Scan disk usage from AI & dev tools')
  .option('--json', 'Output as JSON')
  .option('--only <tools>', 'Only scan specific tools (comma-separated IDs)')
  .option('--exclude <tools>', 'Exclude specific tools (comma-separated IDs)')
  .option('--category <name>', 'Scan only a specific category')
  .option('--no-insights', 'Hide insights')
  .action(async (options) => {
    await engine.init();

    const scanOptions = {};
    if (options.only) scanOptions.only = options.only.split(',').map((s) => s.trim());
    if (options.exclude) scanOptions.exclude = options.exclude.split(',').map((s) => s.trim());
    if (options.category) scanOptions.categories = [options.category];

    if (options.json) {
      const json = await engine.scanJSON(scanOptions);
      console.log(json);
      return;
    }

    const spinner = ora({ text: 'Scanning disk usage...', color: 'cyan' }).start();
    const scanResult = await engine.scan(scanOptions);
    spinner.stop();

    printScanReport(scanResult, options.insights !== false);
  });

// ━━━ CLEAN COMMAND (with full safeguards) ━━━━━━━━━━━━━━━━━━━━━

program
  .command('clean')
  .description('Clean cache and temp files')
  .option('--dry', 'Dry run — preview without deleting')
  .option('--yes, -y', 'Skip confirmation for low-risk items')
  .option('--force', 'Skip ALL confirmations including high-risk (use with caution)')
  .option('--only <tools>', 'Only clean specific tools (comma-separated IDs)')
  .option('--exclude <tools>', 'Exclude specific tools (comma-separated IDs)')
  .option('--risk <level>', 'Only clean tools at this risk level or below (low, medium, high)')
  .option('--older-than <duration>', 'Only clean files not accessed in the given duration (e.g. 30d, 2w, 6h)')
  .action(async (options) => {
    await engine.init();

    const isDryRun = options.dry || false;
    const skipConfirm = options.yes || options.Y || false;
    const forceAll = options.force || false;
    const maxRisk = options.risk || 'high';

    // Parse --older-than duration (Pro feature)
    let olderThan = null;
    if (options.olderThan) {
      await requirePro('age-based cleaning (--older-than)');

      olderThan = parseDuration(options.olderThan);
      if (!olderThan) {
        console.log(chalk.red(`\n  Invalid duration: "${options.olderThan}". Use format like 30d, 2w, or 6h.\n`));
        process.exit(1);
      }
    }

    // ── Lockfile check ──
    if (!isDryRun) {
      const lock = await safety.acquireLock();
      if (!lock.acquired) {
        console.log(chalk.red(`\n  ${lock.reason}\n`));
        process.exit(1);
      }
      // Ensure lock is released on exit
      process.on('exit', () => safety.releaseLock());
      process.on('SIGINT', async () => { await safety.releaseLock(); process.exit(0); });
    }

    try {
      const scanOptions = {};
      if (options.only) scanOptions.only = options.only.split(',').map((s) => s.trim());
      if (options.exclude) scanOptions.exclude = options.exclude.split(',').map((s) => s.trim());

      if (isDryRun) {
        console.log();
        console.log(chalk.bold.yellow('  Dry Run Mode — nothing will be deleted'));
        if (olderThan) {
          console.log(chalk.yellow(`  Age filter: only files not accessed in ${options.olderThan}`));
        }
        console.log();
      }

      if (!isDryRun && olderThan) {
        console.log();
        console.log(chalk.cyan(`  Age filter: only files not accessed in ${options.olderThan}`));
      }

      const spinner = ora({ text: 'Scanning...', color: 'cyan' }).start();
      const scanResult = await engine.scan(scanOptions);
      spinner.stop();

      if (scanResult.grandTotal === 0) {
        console.log(chalk.green('\n  Nothing to clean — your system is already tidy!\n'));
        return;
      }

      // ── Filter by max risk level ──
      const riskOrder = { low: 0, medium: 1, high: 2 };
      const filteredResults = scanResult.results.filter(
        (r) => r.total > 0 && riskOrder[r.risk || 'low'] <= riskOrder[maxRisk]
      );

      if (filteredResults.length === 0) {
        console.log(chalk.green(`\n  No items at risk level "${maxRisk}" or below to clean.\n`));
        return;
      }

      // ── Categorize by risk ──
      const { low, medium, high } = safety.categorizeByRisk(filteredResults);

      // ── Dry run ──
      if (isDryRun) {
        printDryRunReport(low, medium, high);
        const cleanResult = await engine.clean({ ...scanOptions, dryRun: true, olderThan });
        console.log(chalk.bold.yellow('  Would clean:'));
        for (const r of cleanResult.results) {
          console.log(chalk.gray(`    ${r.path} (${r.formatted})`));
        }
        console.log();
        console.log(chalk.dim('  Run `aiclean clean` (without --dry) to proceed.'));
        console.log();
        return;
      }

      // ── Process running check ──
      const registry = require('../core/registry');
      const runningWarnings = [];
      for (const result of filteredResults) {
        const adapter = registry.get(result.id);
        if (adapter) {
          const check = safety.checkToolRunning(adapter);
          if (check.running) {
            runningWarnings.push(check.warning);
          }
        }
      }

      if (runningWarnings.length > 0) {
        console.log();
        console.log(chalk.bold.yellow('  Running processes detected:'));
        for (const w of runningWarnings) {
          console.log(chalk.yellow(`    ! ${w}`));
        }
        console.log();

        if (!forceAll) {
          const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: chalk.yellow('Some tools are running. Continue anyway?'),
            default: false,
          }]);
          if (!proceed) {
            console.log(chalk.yellow('\n  Cancelled.\n'));
            return;
          }
        }
      }

      // ── Size threshold warning ──
      const totalToClean = filteredResults.reduce((s, r) => s + r.total, 0);
      const sizeWarning = safety.getSizeWarning(totalToClean);
      if (sizeWarning && !forceAll) {
        console.log();
        console.log(chalk.bold.red(`  ${sizeWarning}`));
        console.log();
      }

      // ── TIERED CONFIRMATION ──
      const toolsToClean = [];

      // 1. Low-risk items — single batch confirmation
      if (low.length > 0) {
        const lowTotal = low.reduce((s, r) => s + r.total, 0);
        console.log();
        console.log(chalk.bold.green(`  Low-risk items (${formatSize(lowTotal)}):`));
        for (const r of low) {
          console.log(chalk.gray(`    ${r.name}: ${r.formatted}`));
        }

        if (skipConfirm || forceAll) {
          toolsToClean.push(...low.map((r) => r.id));
        } else {
          const { confirmLow } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmLow',
            message: `Clean ${low.length} low-risk items (${formatSize(lowTotal)})?`,
            default: true,
          }]);
          if (confirmLow) toolsToClean.push(...low.map((r) => r.id));
        }
      }

      // 2. Medium-risk items — grouped confirmation with warning
      if (medium.length > 0) {
        const medTotal = medium.reduce((s, r) => s + r.total, 0);
        console.log();
        console.log(chalk.bold.yellow(`  Medium-risk items (${formatSize(medTotal)}):`));
        for (const r of medium) {
          console.log(chalk.yellow(`    ${r.name}: ${r.formatted}`));
          console.log(chalk.gray(`      ${r.riskReason}`));
        }

        if (forceAll) {
          toolsToClean.push(...medium.map((r) => r.id));
        } else {
          const { confirmMed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmMed',
            message: chalk.yellow(`Clean ${medium.length} medium-risk items (${formatSize(medTotal)})? These may slow down your next build/install.`),
            default: false,
          }]);
          if (confirmMed) toolsToClean.push(...medium.map((r) => r.id));
        }
      }

      // 3. High-risk items — INDIVIDUAL confirmation per tool
      if (high.length > 0) {
        console.log();
        console.log(chalk.bold.red(`  High-risk items:`));
        console.log(chalk.red('  These items are expensive to re-download or may be irreversible.'));
        console.log();

        for (const r of high) {
          console.log(chalk.bold.red(`    ${r.name}: ${r.formatted}`));
          console.log(chalk.red(`      ${r.riskReason}`));

          if (forceAll) {
            toolsToClean.push(r.id);
          } else {
            const { confirmHigh } = await inquirer.prompt([{
              type: 'confirm',
              name: 'confirmHigh',
              message: chalk.red(`Delete ${r.name} (${r.formatted})? This action may take a long time to undo.`),
              default: false,
            }]);
            if (confirmHigh) toolsToClean.push(r.id);
          }
        }
      }

      if (toolsToClean.length === 0) {
        console.log(chalk.yellow('\n  No items selected for cleaning.\n'));
        return;
      }

      // ── Execute clean ──
      const cleanSpinner = ora({ text: 'Cleaning...', color: 'green' }).start();
      const cleanResult = await engine.clean({ only: toolsToClean, dryRun: false, olderThan });
      cleanSpinner.stop();

      printCleanResult(cleanResult);
    } finally {
      if (!isDryRun) {
        await safety.releaseLock();
      }
    }
  });

// ━━━ INTERACTIVE COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('interactive')
  .alias('i')
  .description('Interactive mode — choose what to scan and clean')
  .action(async () => {
    await engine.init();

    console.log();
    console.log(chalk.bold.cyan('  aiclean interactive mode'));
    console.log(chalk.dim(`  ${definitions.getCount()} tools supported`));
    console.log();

    const categoryNames = definitions.getCategoryNames();
    const { selectedCategories } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedCategories',
      message: 'Select categories to scan:',
      pageSize: 15,
      choices: categoryNames.map((c) => ({ name: c, checked: true })),
    }]);

    if (selectedCategories.length === 0) {
      console.log(chalk.yellow('\n  No categories selected.\n'));
      return;
    }

    const spinner = ora({ text: 'Scanning selected categories...', color: 'cyan' }).start();
    const scanResult = await engine.scan({ categories: selectedCategories });
    spinner.stop();

    if (scanResult.grandTotal === 0) {
      console.log(chalk.green('\n  Nothing found to clean in selected categories.\n'));
      return;
    }

    const nonEmpty = scanResult.results.filter((r) => r.total > 0);
    console.log();
    console.log(chalk.bold.cyan(`  Found ${formatSize(scanResult.grandTotal)} across ${nonEmpty.length} tools`));
    console.log();

    const { selectedTools } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTools',
      message: 'Select tools to clean:',
      pageSize: 25,
      choices: nonEmpty.map((r) => ({
        name: `${RISK_ICONS[r.risk || 'low']} ${r.name} (${r.formatted})`,
        value: r.id,
        checked: r.risk !== 'high', // high-risk unchecked by default
      })),
    }]);

    if (selectedTools.length === 0) {
      console.log(chalk.yellow('\n  No tools selected.\n'));
      return;
    }

    // Check for high-risk selections
    const highRiskSelected = nonEmpty.filter((r) => selectedTools.includes(r.id) && r.risk === 'high');
    if (highRiskSelected.length > 0) {
      console.log();
      console.log(chalk.bold.red('  Warning: You selected high-risk items:'));
      for (const r of highRiskSelected) {
        console.log(chalk.red(`    ${r.name} (${r.formatted}) — ${r.riskReason}`));
      }
      console.log();

      const { confirmHighRisk } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmHighRisk',
        message: chalk.red('These items are expensive to re-download. Proceed?'),
        default: false,
      }]);

      if (!confirmHighRisk) {
        // Remove high-risk items
        const safeTools = selectedTools.filter(
          (id) => !highRiskSelected.find((r) => r.id === id)
        );
        if (safeTools.length === 0) {
          console.log(chalk.yellow('\n  Cancelled.\n'));
          return;
        }
        selectedTools.length = 0;
        selectedTools.push(...safeTools);
      }
    }

    const totalSelected = nonEmpty
      .filter((r) => selectedTools.includes(r.id))
      .reduce((sum, r) => sum + r.total, 0);

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete ${formatSize(totalSelected)} from ${selectedTools.length} tools?`,
      default: false,
    }]);

    if (!confirm) {
      console.log(chalk.yellow('\n  Cancelled.\n'));
      return;
    }

    const lock = await safety.acquireLock();
    if (!lock.acquired) {
      console.log(chalk.red(`\n  ${lock.reason}\n`));
      return;
    }

    try {
      const cleanSpinner = ora({ text: 'Cleaning...', color: 'green' }).start();
      const cleanResult = await engine.clean({ only: selectedTools, dryRun: false });
      cleanSpinner.stop();
      printCleanResult(cleanResult);
    } finally {
      await safety.releaseLock();
    }
  });

// ━━━ LIST COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('list')
  .alias('ls')
  .description('List all supported tools')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (options.json) {
      await engine.init();
      console.log(JSON.stringify(engine.getAdaptersByCategory(), null, 2));
      return;
    }

    const byCategory = definitions.categories;
    console.log();
    console.log(chalk.bold.cyan(`  Supported Tools (${definitions.getCount()})`));
    console.log(chalk.gray('  ' + '\u2500'.repeat(55)));

    for (const [category, tools] of Object.entries(byCategory)) {
      console.log();
      console.log(chalk.bold(`  ${category}`));
      for (const tool of tools) {
        const risk = RISK_ICONS[tool.risk || 'low'];
        console.log(`    ${risk} ${tool.id.padEnd(20)} ${tool.name}`);
      }
    }
    console.log();
    console.log(chalk.gray('  Risk: ') + chalk.green('LOW') + ' = safe  ' + chalk.yellow('MED') + ' = slower rebuilds  ' + chalk.red('HIGH') + ' = expensive to undo');
    console.log();
  });

// ━━━ AUTO COMMAND (with safety) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('auto')
  .description('Set up automatic cleaning schedule')
  .option('--weekly', 'Run clean weekly')
  .option('--daily', 'Run clean daily')
  .option('--monthly', 'Run clean monthly')
  .option('--off', 'Disable auto-clean and remove cron job')
  .option('--status', 'Show current auto-clean status')
  .option('--include-risky', 'Include medium-risk items in auto-clean (high-risk never included)')
  .action(async (options) => {
    await engine.init();

    // ── Status check ──
    if (options.status) {
      const config = await configLoader.load();
      const cronStatus = safety.getCronStatus();

      console.log();
      console.log(chalk.bold.cyan('  Auto-clean Status'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
      console.log();
      console.log(`  ${chalk.bold('Enabled:')}          ${config.autoClean ? chalk.green('Yes') : chalk.red('No')}`);
      console.log(`  ${chalk.bold('Interval:')}         ${config.interval || 'N/A'}`);
      console.log(`  ${chalk.bold('Include risky:')}    ${config.autoCleanIncludeRisky ? chalk.yellow('Yes') : chalk.green('No (safe mode)')}`);
      console.log(`  ${chalk.bold('Cron job:')}         ${cronStatus.active ? chalk.green('Active') : chalk.gray('Not installed')}`);
      if (cronStatus.active) {
        console.log(`  ${chalk.bold('Schedule:')}         ${cronStatus.schedule}`);
        console.log(`  ${chalk.bold('Cron line:')}        ${chalk.gray(cronStatus.line)}`);
      }
      console.log();
      console.log(chalk.dim('  Auto-clean only runs low-risk items by default.'));
      console.log(chalk.dim('  High-risk items (ML models, Trash, etc.) are NEVER auto-cleaned.'));
      console.log();
      return;
    }

    // ── Disable ──
    if (options.off) {
      await configLoader.set('autoClean', false);
      await removeCronJob();
      console.log(chalk.green('\n  Auto-clean disabled. Cron job removed.\n'));
      return;
    }

    // ── Pro gate: enabling auto-clean requires Pro ──
    await requirePro('auto-clean');

    let interval = 'weekly';
    if (options.daily) interval = 'daily';
    if (options.monthly) interval = 'monthly';

    const includeRisky = options.includeRisky || false;

    // Warn about what auto-clean will do
    console.log();
    console.log(chalk.bold.cyan(`  Setting up auto-clean: ${interval}`));
    console.log();
    console.log(chalk.bold('  What will be auto-cleaned:'));
    console.log(chalk.green('    Low-risk items: caches, logs, temp files'));
    if (includeRisky) {
      console.log(chalk.yellow('    Medium-risk items: package caches, build caches'));
    }
    console.log(chalk.red('    High-risk items: NEVER auto-cleaned (ML models, Trash, etc.)'));
    console.log();

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Enable ${interval} auto-clean?`,
      default: true,
    }]);

    if (!confirm) {
      console.log(chalk.yellow('\n  Cancelled.\n'));
      return;
    }

    await configLoader.set('autoClean', true);
    await configLoader.set('interval', interval);
    await configLoader.set('autoCleanIncludeRisky', includeRisky);

    const riskFlag = includeRisky ? '--risk medium' : '--risk low';
    const result = await setupCronJob(interval, riskFlag);

    console.log(chalk.green(`  Config saved to ${configLoader.RC_FILE}`));
    if (result.success) {
      console.log(chalk.green(`  Cron job installed: ${result.schedule}`));
    } else {
      console.log(chalk.yellow(`  Note: ${result.message}`));
    }
    console.log();
  });

// ━━━ CONFIG COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('config')
  .description('View or update configuration')
  .option('--show', 'Show current config')
  .option('--reset', 'Reset to defaults')
  .option('--set <key=value>', 'Set a config value')
  .option('--get <key>', 'Get a config value')
  .action(async (options) => {
    if (options.reset) {
      await configLoader.reset();
      console.log(chalk.green('\n  Config reset to defaults.\n'));
      return;
    }

    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const valueStr = valueParts.join('=');
      let value;
      try { value = JSON.parse(valueStr); } catch { value = valueStr; }
      await configLoader.set(key.trim(), value);
      console.log(chalk.green(`\n  Set ${key.trim()} = ${JSON.stringify(value)}\n`));
      return;
    }

    if (options.get) {
      const value = await configLoader.get(options.get);
      console.log(JSON.stringify(value, null, 2));
      return;
    }

    const config = await configLoader.load();
    console.log();
    console.log(chalk.bold.cyan('  Configuration'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log();
    printConfigTree(config, '  ');
    console.log();
    console.log(chalk.gray(`  File: ${configLoader.RC_FILE}`));
    console.log();
  });

// ━━━ LOGS COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('logs')
  .description('View cleaning logs and history')
  .option('-n, --lines <number>', 'Number of entries', '20')
  .option('--level <level>', 'Filter by level (info, warn, error, clean)')
  .option('--tool <toolId>', 'Filter by tool ID')
  .option('--summary', 'Show cleaning summary')
  .option('--clear', 'Clear all logs')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (options.clear) {
      await logger.clearLogs();
      console.log(chalk.green('\n  Logs cleared.\n'));
      return;
    }

    if (options.summary) {
      const summary = await logger.getCleaningSummary();
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      printCleaningSummary(summary);
      return;
    }

    const logs = await logger.readLogs({
      limit: parseInt(options.lines, 10),
      level: options.level,
      toolId: options.tool,
    });

    if (options.json) {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }

    if (logs.length === 0) {
      console.log(chalk.yellow('\n  No logs found. Run `aiclean clean` first.\n'));
      return;
    }

    console.log();
    console.log(chalk.bold.cyan('  Cleaning Logs'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
    console.log();

    for (const entry of logs) {
      const date = new Date(entry.timestamp).toLocaleString();
      const levelColor = { info: chalk.blue, warn: chalk.yellow, error: chalk.red, clean: chalk.green }[entry.level] || chalk.white;
      const size = entry.bytesReclaimedFormatted ? ` (${entry.bytesReclaimedFormatted})` : '';
      console.log(`  ${chalk.gray(date)} ${levelColor(entry.level.padEnd(5))} ${entry.message}${size}`);
    }
    console.log();
  });

// ━━━ STATS COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('stats')
  .description('View usage statistics')
  .option('--json', 'Output as JSON')
  .option('--reset', 'Reset statistics')
  .action(async (options) => {
    await engine.init();

    if (options.reset) {
      await telemetry.reset();
      console.log(chalk.green('\n  Statistics reset.\n'));
      return;
    }

    const stats = telemetry.getStats();

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold.cyan('  Usage Statistics'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log();
    console.log(`  ${chalk.bold('Total scans:')}        ${stats.totalScans}`);
    console.log(`  ${chalk.bold('Total cleans:')}       ${stats.totalCleans}`);
    console.log(`  ${chalk.bold('Space reclaimed:')}    ${chalk.green(stats.totalBytesReclaimedFormatted)}`);
    console.log(`  ${chalk.bold('Tools supported:')}    ${definitions.getCount()}`);
    console.log(`  ${chalk.bold('Member since:')}       ${new Date(stats.firstUsed).toLocaleDateString()}`);
    console.log(`  ${chalk.bold('Last active:')}        ${new Date(stats.lastUsed).toLocaleDateString()}`);
    console.log();
  });

// ━━━ UNLOCK COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('unlock')
  .description('Force-release a stale clean lock')
  .action(async () => {
    const lockStatus = await safety.isLocked();
    if (!lockStatus.locked) {
      console.log(chalk.green('\n  No lock is held.\n'));
      return;
    }

    console.log();
    console.log(chalk.yellow(`  Lock held by PID ${lockStatus.pid} since ${new Date(lockStatus.timestamp).toLocaleString()}`));
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Force release this lock?',
      default: false,
    }]);

    if (confirm) {
      await safety.forceUnlock();
      console.log(chalk.green('  Lock released.\n'));
    }
  });

// ━━━ LOGIN COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('login')
  .description('Authenticate with your API key')
  .option('--key <key>', 'API key (or enter interactively)')
  .option('--email <email>', 'Account email')
  .action(async (options) => {
    // Check if already logged in
    const existing = await apiClient.getAccountStatus();
    if (existing.authenticated) {
      console.log();
      console.log(chalk.yellow(`  Already logged in as ${existing.email} (${existing.plan} plan).`));
      const { relogin } = await inquirer.prompt([{
        type: 'confirm',
        name: 'relogin',
        message: 'Log in with a different account?',
        default: false,
      }]);
      if (!relogin) return;
    }

    // Get API key
    let apiKey = options.key;
    if (!apiKey) {
      console.log();
      console.log(chalk.dim('  Get your API key at https://aiclean.tech/settings'));
      console.log(chalk.dim('  Format: ak_live_xxxxx or ak_test_xxxxx'));
      console.log();
      const answer = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'API key:', mask: '*' },
      ]);
      apiKey = answer.apiKey;
    }

    // Validate key format before hitting the server
    const keyCheck = apiClient.validateKeyFormat(apiKey);
    if (!keyCheck.valid) {
      console.log(chalk.red(`\n  ${keyCheck.reason}\n`));
      return;
    }

    // Get email
    let email = options.email;
    if (!email) {
      const answer = await inquirer.prompt([
        { type: 'input', name: 'email', message: 'Account email:' },
      ]);
      email = answer.email;
    }

    const emailCheck = apiClient.validateEmail(email);
    if (!emailCheck.valid) {
      console.log(chalk.red(`\n  ${emailCheck.reason}\n`));
      return;
    }

    // Authenticate
    const spinner = ora('Verifying API key...').start();
    const result = await apiClient.login(apiKey, email);
    spinner.stop();

    if (result.success) {
      console.log();
      console.log(chalk.green('  Authenticated successfully!'));
      console.log();
      console.log(`  ${chalk.bold('Email:')}  ${email}`);
      console.log(`  ${chalk.bold('Plan:')}   ${result.plan === 'pro' ? chalk.green('Pro') : chalk.dim('Free')}`);
      if (result.plan === 'pro') {
        console.log();
        console.log(chalk.dim('  Pro features unlocked: auto-clean, priority support, early access.'));
      } else {
        console.log();
        console.log(chalk.dim('  Upgrade to Pro at https://aiclean.tech/pricing'));
      }
      console.log();
    } else {
      console.log(chalk.red(`\n  ${result.message}\n`));
    }
  });

// ━━━ LOGOUT COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('logout')
  .description('Remove stored credentials')
  .action(async () => {
    const status = await apiClient.getAccountStatus();
    if (!status.authenticated) {
      console.log(chalk.dim('\n  Not logged in.\n'));
      return;
    }

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Log out ${status.email}?`,
      default: true,
    }]);

    if (!confirm) return;

    const result = await apiClient.logout();
    console.log(chalk.green(`\n  ${result.message}\n`));
  });

// ━━━ PLAN COMMAND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('plan')
  .description('Show current plan and account status')
  .action(async () => {
    const status = await apiClient.getAccountStatus();

    console.log();
    console.log(chalk.bold.cyan('  Account & Plan'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log();

    if (!status.authenticated) {
      console.log(`  ${chalk.bold('Status:')}  ${chalk.dim('Not logged in')}`);
      console.log(`  ${chalk.bold('Plan:')}    ${chalk.dim('Free')}`);
      console.log();
      console.log(chalk.dim('  All scan & clean features work without logging in.'));
      console.log(chalk.dim('  Pro features (auto-clean) require authentication.'));
      console.log();
      console.log(chalk.bold('  To upgrade:'));
      console.log(chalk.dim('    1. Subscribe at ') + chalk.underline('https://aiclean.tech/pricing'));
      console.log(chalk.dim('    2. Run: ') + chalk.bold('aiclean login'));
    } else {
      console.log(`  ${chalk.bold('Status:')}      ${chalk.green('Authenticated')}`);
      console.log(`  ${chalk.bold('Email:')}       ${status.email}`);
      console.log(`  ${chalk.bold('Plan:')}        ${status.plan === 'pro' ? chalk.green('Pro') : chalk.dim('Free')}`);
      console.log(`  ${chalk.bold('Verified:')}    ${new Date(status.validatedAt).toLocaleString()}`);
      console.log(`  ${chalk.bold('Source:')}      ${status.source === 'server' ? 'Server verified' : 'Local (offline)'}`);

      if (status.plan === 'pro') {
        console.log();
        console.log(chalk.green('  Pro features:'));
        console.log(chalk.dim('    - Scheduled auto-clean (aiclean auto --weekly)'));
        console.log(chalk.dim('    - Priority support'));
        console.log(chalk.dim('    - Early access to new features'));
      } else {
        console.log();
        console.log(chalk.dim('  Upgrade to Pro at https://aiclean.tech/pricing'));
      }
    }
    console.log();
  });

// ━━━ HELPER FUNCTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function printScanReport(scanResult, showInsights = true) {
  const nonEmpty = scanResult.results.filter((r) => r.total > 0);

  console.log();
  console.log(chalk.bold.cyan('  AI & Dev Tool Disk Usage Report'));
  console.log(chalk.gray('  ' + '\u2500'.repeat(55)));
  console.log();

  // Group by category
  const byCategory = new Map();
  for (const tool of nonEmpty) {
    const cat = tool.category || 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(tool);
  }

  for (const [category, tools] of byCategory) {
    const catTotal = tools.reduce((s, t) => s + t.total, 0);
    console.log(chalk.bold(`  ${category} ${chalk.gray('(' + formatSize(catTotal) + ')')}`));

    for (const tool of tools) {
      const risk = RISK_ICONS[tool.risk || 'low'];
      console.log(`    ${risk} ${tool.name}: ${chalk.yellow(tool.formatted)}`);
      for (const cat of tool.categories) {
        console.log(chalk.gray(`         ${cat.name}: ${cat.formatted}`));
      }
    }
    console.log();
  }

  console.log(chalk.gray('  ' + '\u2500'.repeat(55)));
  console.log(
    chalk.bold(`  Total reclaimable: ${chalk.green(scanResult.grandTotalFormatted)}`) +
    chalk.gray(` across ${scanResult.nonEmptyCount} tools`)
  );
  console.log();

  // Risk summary
  const { low, medium, high } = safety.categorizeByRisk(nonEmpty);
  if (low.length > 0 || medium.length > 0 || high.length > 0) {
    const lowTotal = low.reduce((s, r) => s + r.total, 0);
    const medTotal = medium.reduce((s, r) => s + r.total, 0);
    const highTotal = high.reduce((s, r) => s + r.total, 0);
    console.log(chalk.bold('  By risk level:'));
    if (low.length > 0) console.log(chalk.green(`    LOW:  ${formatSize(lowTotal)} (${low.length} tools) — safe to clean`));
    if (medium.length > 0) console.log(chalk.yellow(`    MED:  ${formatSize(medTotal)} (${medium.length} tools) — may slow rebuilds`));
    if (high.length > 0) console.log(chalk.red(`    HIGH: ${formatSize(highTotal)} (${high.length} tools) — expensive to undo`));
    console.log();
  }

  // Insights
  if (showInsights && scanResult.insights.length > 0) {
    console.log(chalk.bold('  Insights'));
    for (const insight of scanResult.insights) {
      const icon = { critical: chalk.red('!!'), warning: chalk.yellow('!'), info: chalk.blue('i') }[insight.level] || chalk.blue('i');
      console.log(`  ${icon} ${insight.message}`);
    }
    console.log();
  }

  console.log(chalk.dim('  Pro tip: Enable auto-clean & smart alerts at aiclean.tech'));
  console.log();
}

function printDryRunReport(low, medium, high) {
  console.log();
  if (low.length > 0) {
    const lowTotal = low.reduce((s, r) => s + r.total, 0);
    console.log(chalk.green(`  Low-risk (${formatSize(lowTotal)}):`));
    for (const r of low) console.log(chalk.gray(`    ${r.name}: ${r.formatted}`));
  }
  if (medium.length > 0) {
    const medTotal = medium.reduce((s, r) => s + r.total, 0);
    console.log(chalk.yellow(`  Medium-risk (${formatSize(medTotal)}):`));
    for (const r of medium) console.log(chalk.yellow(`    ${r.name}: ${r.formatted} — ${r.riskReason}`));
  }
  if (high.length > 0) {
    const highTotal = high.reduce((s, r) => s + r.total, 0);
    console.log(chalk.red(`  High-risk (${formatSize(highTotal)}):`));
    for (const r of high) console.log(chalk.red(`    ${r.name}: ${r.formatted} — ${r.riskReason}`));
  }
  console.log();
}

function printCleanResult(cleanResult) {
  console.log();
  console.log(chalk.bold.green('  Clean completed!'));
  console.log();

  const byTool = new Map();
  for (const r of cleanResult.results) {
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool).push(r);
  }

  for (const [tool, results] of byTool) {
    const toolTotal = results.reduce((s, r) => s + r.size, 0);
    const hasError = results.some((r) => r.action === 'error');
    const icon = hasError ? chalk.yellow('~') : chalk.green('\u2713');
    console.log(`  ${icon} ${tool}: ${chalk.green(formatSize(toolTotal))}`);

    for (const r of results) {
      if (r.action === 'error') {
        console.log(chalk.red(`      ${r.name}: Error — ${r.error}`));
      }
    }
  }

  console.log();
  console.log(chalk.bold.green(`  Total reclaimed: ${cleanResult.totalReclaimedFormatted}`));

  if (cleanResult.errorCount > 0) {
    console.log(chalk.yellow(`  ${cleanResult.errorCount} errors (likely permission issues)`));
  }

  console.log();
  console.log(chalk.dim(`  Saved ${cleanResult.totalReclaimedFormatted} — automate this with aiclean Pro at aiclean.tech`));
  console.log();
}

function printCleaningSummary(summary) {
  console.log();
  console.log(chalk.bold.cyan('  Cleaning History'));
  console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
  console.log();

  if (summary.totalCleans === 0) {
    console.log(chalk.yellow('  No cleaning history yet.'));
    console.log();
    return;
  }

  console.log(`  ${chalk.bold('Total cleans:')}       ${summary.totalCleans}`);
  console.log(`  ${chalk.bold('Total reclaimed:')}    ${chalk.green(summary.totalBytesReclaimedFormatted)}`);
  console.log(`  ${chalk.bold('First clean:')}        ${new Date(summary.firstClean).toLocaleString()}`);
  console.log(`  ${chalk.bold('Last clean:')}         ${new Date(summary.lastClean).toLocaleString()}`);
  console.log();

  if (Object.keys(summary.tools).length > 0) {
    console.log(chalk.bold('  By tool:'));
    for (const [toolId, data] of Object.entries(summary.tools)) {
      console.log(`    ${toolId}: ${data.cleans} cleans, ${formatSize(data.bytesReclaimed)} reclaimed`);
    }
    console.log();
  }
}

function printConfigTree(obj, prefix = '') {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      console.log(`${prefix}${chalk.bold(key)}:`);
      printConfigTree(value, prefix + '  ');
    } else {
      console.log(`${prefix}${chalk.bold(key)}: ${chalk.yellow(JSON.stringify(value))}`);
    }
  }
}

// ━━━ CRON JOB MANAGEMENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function setupCronJob(interval, riskFlag) {
  const os = require('os');
  const { execSync } = require('child_process');

  const schedules = {
    daily: '0 9 * * *',
    weekly: '0 9 * * 1',
    monthly: '0 9 1 * *',
  };

  const schedule = schedules[interval] || schedules.weekly;

  let aicleanPath;
  try {
    aicleanPath = execSync('which aiclean 2>/dev/null || echo ""').toString().trim();
  } catch {
    aicleanPath = '';
  }

  if (!aicleanPath) {
    aicleanPath = require('path').resolve(__dirname, 'index.js');
    aicleanPath = `node ${aicleanPath}`;
  }

  const cronLine = `${schedule} ${aicleanPath} clean --yes ${riskFlag} > /dev/null 2>&1`;

  if (os.platform() === 'darwin' || os.platform() === 'linux') {
    try {
      const currentCron = execSync('crontab -l 2>/dev/null || echo ""').toString();
      const filteredLines = currentCron.split('\n').filter((line) => !line.includes('aiclean')).filter(Boolean);
      filteredLines.push(cronLine);
      const newCron = filteredLines.join('\n') + '\n';
      execSync(`echo "${newCron}" | crontab -`);
      return { success: true, schedule: `${schedule} (${interval})` };
    } catch (err) {
      return { success: false, message: `Could not install cron: ${err.message}` };
    }
  }

  return { success: false, message: 'Cron not supported on this platform' };
}

async function removeCronJob() {
  const { execSync } = require('child_process');
  try {
    const currentCron = execSync('crontab -l 2>/dev/null || echo ""').toString();
    const filteredLines = currentCron.split('\n').filter((line) => !line.includes('aiclean')).filter(Boolean);
    if (filteredLines.length > 0) {
      execSync(`echo "${filteredLines.join('\n')}\n" | crontab -`);
    } else {
      execSync('crontab -r 2>/dev/null || true');
    }
  } catch {
    // Non-critical
  }
}

// ━━━ PARSE + RUN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if (!process.argv.slice(2).length) {
  console.log();
  console.log(chalk.bold.cyan('  aiclean') + chalk.dim(` v${pkg.version} — ${definitions.getCount()} tools supported`));
  console.log(chalk.dim('  Scan and clean disk usage from AI & dev tools'));
  console.log();
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);
