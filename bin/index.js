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
const { requirePro, PRO_FEATURES } = require('../utils/auth');
const snapshots = require('../core/snapshots');
const guardian = require('../core/guardian');
const dedupe = require('../core/dedupe');
const projects = require('../core/projects');
const rules = require('../core/rules');
const registryFetch = require('../core/registry-fetch');
const reporter = require('../telemetry/reporter');
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
  .option('--no-snapshot', 'Skip snapshot creation for Pro users (not recommended)')
  .action(async (options) => {
    await engine.init();

    const isDryRun = options.dry || false;
    const skipConfirm = options.yes || options.Y || false;
    const forceAll = options.force || false;
    const maxRisk = options.risk || 'high';
    const wantSnapshot = options.snapshot !== false; // default ON for Pro users

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

      // ── Snapshot (Pro) before touching anything medium/high risk ──
      const hasMediumOrHigh = toolsToClean.some((id) => {
        const r = filteredResults.find((x) => x.id === id);
        return r && (r.risk === 'medium' || r.risk === 'high');
      });
      if (wantSnapshot && hasMediumOrHigh) {
        const isProUser = await apiClient.isPro();
        if (isProUser) {
          const backend = snapshots.detectBackend();
          if (backend !== 'none') {
            const snapSpin = ora({ text: `Creating ${backend} snapshot (restore point)...`, color: 'cyan' }).start();
            const snap = await snapshots.create({ reason: 'pre-clean' });
            snapSpin.stop();
            if (snap.success) {
              console.log(chalk.green(`  Snapshot created: ${snap.snapshot.id}`));
              console.log(chalk.dim(`  Roll back with: aiclean restore --last`));
            } else if (!snap.skipped) {
              console.log(chalk.yellow(`  Snapshot failed (continuing): ${snap.reason}`));
            }
          }
        }
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
  .description('Authenticate with your license key')
  .option('--key <key>', 'License key (or enter interactively)')
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

    // Get license key
    let licenseKey = options.key;
    if (!licenseKey) {
      console.log();
      console.log(chalk.dim('  Enter the license key from your purchase confirmation email.'));
      console.log(chalk.dim('  Purchase at https://aiclean.tech/pricing'));
      console.log();
      const answer = await inquirer.prompt([
        { type: 'password', name: 'licenseKey', message: 'License key:', mask: '*' },
      ]);
      licenseKey = answer.licenseKey;
    }

    // Validate key format before hitting the server
    const keyCheck = apiClient.validateKeyFormat(licenseKey);
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
    const spinner = ora('Verifying license key...').start();
    const result = await apiClient.login(licenseKey, email);
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

// ━━━ JOIN COMMAND (team members) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('join')
  .description('Join a team as a member using the code from your admin')
  .argument('[code]', 'Member token (JWT) from your team invite')
  .option('--code <code>', 'Alternative way to pass the code')
  .action(async (positional, options) => {
    // Check if already logged in
    const existing = await apiClient.getAccountStatus();
    if (existing.authenticated) {
      console.log();
      console.log(chalk.yellow(`  Already logged in as ${existing.email} (${existing.plan} plan).`));
      const { relogin } = await inquirer.prompt([{
        type: 'confirm',
        name: 'relogin',
        message: 'Replace with a team member credential?',
        default: false,
      }]);
      if (!relogin) return;
    }

    let code = positional || options.code;
    if (!code) {
      console.log();
      console.log(chalk.dim('  Paste the `aiclean join ...` code your admin sent you.'));
      console.log(chalk.dim('  They get it from https://aiclean.tech/dashboard after inviting you.'));
      console.log();
      const answer = await inquirer.prompt([
        { type: 'password', name: 'code', message: 'Member code:', mask: '*' },
      ]);
      code = answer.code;
    }

    const spinner = ora('Verifying member code...').start();
    const result = await apiClient.joinTeam(code);
    spinner.stop();

    if (result.success) {
      console.log();
      console.log(chalk.green('  Joined team!'));
      console.log();
      console.log(`  ${chalk.bold('Email:')} ${result.email}`);
      console.log(`  ${chalk.bold('Plan:')}  ${chalk.green('Pro (via team)')}`);
      console.log(`  ${chalk.bold('Org:')}   ${result.orgId}`);
      console.log();
      console.log(chalk.dim('  Pro features unlocked: rollback, guardian, dedupe, projects,'));
      console.log(chalk.dim('  smart rules, live registry, fleet telemetry.'));
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
      console.log(chalk.dim('    1. Purchase at ') + chalk.underline('https://aiclean.tech/pricing'));
      console.log(chalk.dim('    2. Run: ') + chalk.bold('aiclean login') + chalk.dim(' with your license key'));
    } else {
      const auth = await apiClient.getAuth();
      const isMember = auth?.kind === 'member';
      console.log(`  ${chalk.bold('Status:')}      ${chalk.green('Authenticated')}`);
      console.log(`  ${chalk.bold('Email:')}       ${status.email}`);
      console.log(`  ${chalk.bold('Plan:')}        ${status.plan === 'pro' ? chalk.green('Pro') : chalk.dim('Free')}${isMember ? chalk.dim(' (via team)') : ''}`);
      if (isMember) console.log(`  ${chalk.bold('Org:')}         ${auth.orgId}`);
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

// ━━━ RESTORE COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('restore')
  .description('List or roll back a snapshot created before a clean')
  .option('--list', 'List all snapshots')
  .option('--last', 'Restore from the most recent snapshot')
  .option('--id <id>', 'Restore a specific snapshot by id')
  .option('--delete <id>', 'Delete a snapshot')
  .option('--prune [keep]', 'Keep N most recent snapshots (default 5)')
  .action(async (options) => {
    await requirePro('rollback / snapshots (aiclean restore)');

    if (options.list || (!options.last && !options.id && !options.delete && options.prune === undefined)) {
      const list = await snapshots.list();
      if (list.length === 0) {
        console.log(chalk.yellow('\n  No snapshots yet.\n'));
        console.log(chalk.dim('  Snapshots are created automatically before medium/high-risk cleans.'));
        console.log();
        return;
      }
      console.log();
      console.log(chalk.bold.cyan('  Snapshots'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
      for (const s of list) {
        console.log(`  ${chalk.bold(s.id)} ${chalk.gray(s.backend)}`);
        console.log(chalk.gray(`    ${new Date(s.timestamp).toLocaleString()}  \u2014  ${s.reason}`));
      }
      console.log();
      return;
    }

    if (options.prune !== undefined) {
      const keep = typeof options.prune === 'string' ? parseInt(options.prune, 10) || 5 : 5;
      const r = await snapshots.prune(keep);
      console.log(chalk.green(`\n  Kept ${r.kept}, removed ${r.removed.length}.\n`));
      return;
    }

    if (options.delete) {
      const r = await snapshots.remove(options.delete);
      console.log();
      console.log(r.success ? chalk.green(`  Removed ${options.delete}`) : chalk.red(`  ${r.reason}`));
      console.log();
      return;
    }

    let id = options.id;
    if (options.last) {
      const list = await snapshots.list();
      if (list.length === 0) {
        console.log(chalk.yellow('\n  No snapshots to restore.\n'));
        return;
      }
      id = list[0].id;
    }

    console.log();
    console.log(chalk.bold.yellow(`  About to restore snapshot: ${id}`));
    console.log();

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: chalk.yellow('This overwrites current state. Continue?'),
      default: false,
    }]);
    if (!confirm) {
      console.log(chalk.yellow('\n  Cancelled.\n'));
      return;
    }

    const r = await snapshots.restore(id);
    console.log();
    if (r.success) {
      console.log(chalk.green(`  ${r.message || 'Restored.'}`));
    } else if (r.manual) {
      console.log(chalk.yellow(r.message));
    } else {
      console.log(chalk.red(`  Restore failed: ${r.reason}`));
    }
    console.log();
  });

// ━━━ GUARD COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('guard')
  .description('Pre-flight disk guardian for AI/dev-tool downloads')
  .option('--install', 'Install shim wrappers for ollama, huggingface-cli, docker, pip, npm, cargo')
  .option('--uninstall', 'Remove all shim wrappers')
  .option('--status', 'Show current guard status')
  .option('--orphans', 'Find and optionally clean orphaned partial downloads (free)')
  .action(async (options) => {
    // Orphan detection is free — everyone gets it.
    if (options.orphans) {
      console.log();
      console.log(chalk.bold.cyan('  Scanning for orphaned partial downloads...'));
      const ollama = await guardian.findOllamaOrphans();
      const hf = await guardian.findHFOrphans();
      const all = [...ollama, ...hf];
      if (all.length === 0) {
        console.log(chalk.green('  No orphans found.\n'));
        return;
      }
      const total = all.reduce((s, o) => s + o.size, 0);
      console.log();
      for (const o of all) console.log(chalk.gray(`    ${formatSize(o.size).padStart(9)}  ${o.path}`));
      console.log();
      console.log(chalk.yellow(`  Total: ${formatSize(total)} in ${all.length} files`));

      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Delete orphaned partial downloads?',
        default: false,
      }]);
      if (confirm) {
        const fsx = require('fs-extra');
        for (const o of all) await fsx.remove(o.path).catch(() => {});
        console.log(chalk.green(`\n  Removed ${all.length} orphans (${formatSize(total)}).\n`));
      }
      return;
    }

    if (options.status) {
      const s = await guardian.guardStatus();
      console.log();
      console.log(chalk.bold.cyan('  Guard Status'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
      if (!s.installed) {
        console.log(chalk.dim('  Not installed. Run: aiclean guard --install'));
        console.log();
        return;
      }
      console.log(`  Installed at:  ${s.installedAt}`);
      console.log(`  Shim count:    ${s.shimCount}`);
      console.log(`  Shims dir:     ${s.shimsDir}`);
      console.log(`  In PATH:       ${s.inPath ? chalk.green('yes') : chalk.yellow('no')}`);
      if (s.pathHint) {
        console.log();
        console.log(chalk.yellow('  ' + s.pathHint));
      }
      console.log();
      return;
    }

    if (options.uninstall) {
      await requirePro('pre-flight disk guardian (aiclean guard)');
      await guardian.uninstallShims();
      console.log(chalk.green('\n  Guard shims uninstalled.\n'));
      return;
    }

    if (options.install) {
      await requirePro('pre-flight disk guardian (aiclean guard)');
      console.log();
      console.log(chalk.bold.cyan('  Installing guard shims...'));
      const r = await guardian.installShims();
      console.log();
      for (const s of r.installed) console.log(chalk.green(`  \u2713 ${s.cmd}  \u2192  ${s.realPath}`));
      for (const s of r.skipped) console.log(chalk.dim(`  \u2013 ${s.cmd} (${s.reason})`));
      console.log();
      console.log(chalk.yellow('  Next step: add the shims dir to the front of your PATH.'));
      console.log(chalk.bold(`    export PATH="${r.shimsDir}:$PATH"`));
      console.log();
      return;
    }

    // No option — show help.
    console.log();
    console.log(chalk.bold('  aiclean guard') + chalk.dim(' \u2014 pre-flight disk guardian'));
    console.log();
    console.log('  --install    Install shim wrappers (Pro)');
    console.log('  --uninstall  Remove shim wrappers (Pro)');
    console.log('  --status     Show current status (free)');
    console.log('  --orphans    Scan & clean orphaned partial downloads (free)');
    console.log();
  });

// ━━━ GUARD INVOKE (internal — called by shim) ━━━━━━━━━━━━━━━━
program
  .command('guard-invoke')
  .description('[internal] Called by guard shim scripts')
  .option('--tool <name>', 'Tool name')
  .option('--real <path>', 'Real binary path')
  .allowUnknownOption()
  .action(async (options, cmd) => {
    const { spawn } = require('child_process');
    const toolArgv = cmd.args || [];
    const result = await guardian.invoke({ tool: options.tool, real: options.real, argv: toolArgv });

    if (result.intercepted) {
      const { check, estimate } = result;
      console.log();
      console.log(chalk.bold.yellow(`  aiclean guard: ${options.tool} wants ${formatSize(estimate)}, you have ${formatSize(check.freeBytes)} free.`));
      console.log(chalk.yellow(`  Short by about ${formatSize(check.deficit)}. Run \`aiclean clean\` first?`));
      console.log();
      const { proceed } = await inquirer.prompt([{
        type: 'list',
        name: 'proceed',
        message: 'What would you like to do?',
        choices: [
          { name: 'Clean first, then continue', value: 'clean' },
          { name: 'Continue anyway', value: 'continue' },
          { name: 'Cancel', value: 'cancel' },
        ],
      }]);
      if (proceed === 'cancel') process.exit(1);
      if (proceed === 'clean') {
        const { execSync: es } = require('child_process');
        try { es('aiclean clean --risk low --yes', { stdio: 'inherit' }); } catch { /* ignore */ }
      }
    }

    // Exec the real binary transparently.
    const child = spawn(options.real, toolArgv, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code == null ? 1 : code));
  });

// ━━━ DEDUPE COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('dedupe')
  .description('Find duplicate ML model weights across Ollama / HuggingFace / LM Studio / torch.hub')
  .option('--min-size <size>', 'Minimum file size to consider (e.g. 500MB, 1GB)', '100MB')
  .option('--hardlink', 'Replace duplicates with hardlinks to reclaim space')
  .option('--dry', 'Preview only')
  .action(async (options) => {
    await requirePro('duplicate model detection (aiclean dedupe)');

    const minSize = parseDuration(options.minSize) || (require('../utils/size').parseSize(options.minSize)) || 100 * 1024 * 1024;
    const spinner = ora({ text: 'Scanning model caches...', color: 'cyan' }).start();
    let progress = { walked: 0, hashed: 0 };
    const r = await dedupe.scan({
      minSize,
      onProgress: (p) => {
        if (p.phase === 'walk') progress.walked = p.filesScanned;
        if (p.phase === 'hash') progress.hashed = p.filesHashed;
        spinner.text = `Scanning... ${progress.walked} files walked, ${progress.hashed} hashed`;
      },
    });
    spinner.stop();

    console.log();
    console.log(chalk.bold.cyan('  Duplicate Models'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
    if (r.duplicates.length === 0) {
      console.log(chalk.green('  No duplicates found.\n'));
      return;
    }

    for (const group of r.duplicates) {
      console.log();
      console.log(chalk.bold(`  ${group.sizeFormatted} \u00d7 ${group.copies} copies \u2014 ${chalk.yellow(group.wasteFormatted)} reclaimable`));
      for (const f of group.files) {
        console.log(chalk.gray(`    [${f.rootName}] ${f.path}`));
      }
    }
    console.log();
    console.log(chalk.bold(`  Total reclaimable: ${chalk.green(r.totalWasteFormatted)} across ${r.groupCount} groups`));
    console.log();

    if (!options.hardlink) {
      console.log(chalk.dim('  Run with --hardlink to replace duplicates with hardlinks.'));
      console.log();
      return;
    }

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Hardlink duplicates to reclaim ${r.totalWasteFormatted}?`,
      default: false,
    }]);
    if (!confirm) {
      console.log(chalk.yellow('\n  Cancelled.\n'));
      return;
    }

    let linked = 0; let errored = 0; let reclaimed = 0;
    for (const group of r.duplicates) {
      const res = await dedupe.hardlinkGroup(group, { dryRun: options.dry });
      for (const x of res) {
        if (x.action === 'linked' || x.action === 'would-link') { linked++; reclaimed += x.size || 0; }
        if (x.action === 'error') errored++;
      }
    }
    console.log();
    console.log(chalk.bold.green(`  ${options.dry ? 'Would link' : 'Linked'} ${linked} files \u2014 reclaimed ${formatSize(reclaimed)}`));
    if (errored) console.log(chalk.yellow(`  ${errored} errors`));
    console.log();
  });

// ━━━ PROJECTS COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('projects')
  .description('Find project build artifacts (node_modules, target, .venv) grouped by git repo')
  .option('--dormant <duration>', 'Only show repos with no git activity in this duration (e.g. 30d, 90d)')
  .option('--root <paths>', 'Comma-separated project root dirs (default: ~/Projects, ~/Code, ~/dev, ...)')
  .option('--clean', 'Clean selected artifacts interactively')
  .action(async (options) => {
    await requirePro('project-aware cleaning (aiclean projects)');

    const roots = options.root ? options.root.split(',').map((p) => p.trim()) : undefined;
    const spinner = ora({ text: 'Walking project directories...', color: 'cyan' }).start();
    const r = await projects.scan({ roots, dormantDuration: options.dormant });
    spinner.stop();

    if (r.projects.length === 0) {
      console.log(chalk.yellow('\n  No projects found.\n'));
      console.log(chalk.dim('  Try: aiclean projects --root ~/my/projects,~/work'));
      console.log();
      return;
    }

    console.log();
    console.log(chalk.bold.cyan('  Projects'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(55)));

    const toShow = options.dormant ? r.projects.filter((p) => p.dormant) : r.projects;
    for (const p of toShow) {
      const dormantTag = p.dormant ? chalk.red(' [dormant]') : '';
      const age = p.daysSinceCommit != null ? chalk.gray(` (${p.daysSinceCommit}d since commit)`) : '';
      console.log();
      console.log(`  ${chalk.bold(p.repoRoot)}${dormantTag}${age}`);
      console.log(chalk.gray(`    Total: ${chalk.yellow(p.totalSizeFormatted)}`));
      for (const a of p.artifacts) {
        console.log(chalk.gray(`      ${a.sizeFormatted.padStart(9)}  ${a.name.padEnd(18)} ${a.path}`));
      }
    }

    console.log();
    console.log(chalk.bold(`  Total reclaimable: ${chalk.green(r.totalReclaimableFormatted)} across ${toShow.length} projects`));
    if (options.dormant) {
      console.log(chalk.dim(`  Dormant: ${r.dormantTotalFormatted} across ${r.dormantCount} projects`));
    }
    console.log();

    if (!options.clean) return;

    const choices = toShow.flatMap((p) =>
      p.artifacts.map((a) => ({ name: `${a.sizeFormatted.padStart(9)}  ${a.path}`, value: a.path, checked: p.dormant }))
    );
    const { selected } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selected',
      message: 'Select artifacts to delete:',
      pageSize: 25,
      choices,
    }]);
    if (selected.length === 0) return;

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete ${selected.length} artifacts?`,
      default: false,
    }]);
    if (!confirm) return;

    const results = await projects.cleanPaths(selected, { dryRun: false });
    const reclaimed = results.reduce((s, x) => s + (x.size || 0), 0);
    console.log();
    console.log(chalk.bold.green(`  Reclaimed ${formatSize(reclaimed)}.`));
    console.log();
  });

// ━━━ RULES COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('rules')
  .description('Manage smart cleaning rules')
  .option('--list', 'List configured rules')
  .option('--add', 'Add a rule interactively')
  .option('--remove <id>', 'Remove a rule by id')
  .option('--test', 'Evaluate rules now against the current context')
  .action(async (options) => {
    await requirePro('smart rules engine (aiclean rules)');
    const cfg = await configLoader.load();
    const rulesArr = Array.isArray(cfg.rules) ? cfg.rules : [];

    if (options.remove) {
      const next = rulesArr.filter((r) => r.id !== options.remove);
      await configLoader.set('rules', next);
      console.log(chalk.green(`\n  Removed rule: ${options.remove}\n`));
      return;
    }

    if (options.add) {
      const ans = await inquirer.prompt([
        { type: 'input', name: 'id', message: 'Rule id:' },
        { type: 'input', name: 'when', message: 'When (JSON, e.g. {"disk.freePercent":"< 20"}):', default: '{}' },
        { type: 'input', name: 'doo', message: 'Do (JSON, e.g. {"action":"clean","risk":"low"}):', default: '{"action":"clean","risk":"low"}' },
      ]);
      let whenObj, doObj;
      try { whenObj = JSON.parse(ans.when); doObj = JSON.parse(ans.doo); }
      catch (e) { console.log(chalk.red(`\n  Invalid JSON: ${e.message}\n`)); return; }
      rulesArr.push({ id: ans.id, when: whenObj, do: doObj });
      await configLoader.set('rules', rulesArr);
      console.log(chalk.green(`\n  Added rule: ${ans.id}\n`));
      return;
    }

    if (options.test) {
      const ctx = await rules.buildContext({ scanResult: await engine.scan() });
      const firing = rules.evaluate(rulesArr, ctx);
      console.log();
      console.log(chalk.bold.cyan('  Rule evaluation'));
      console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
      console.log(`  Disk free: ${ctx.disk.freePercent.toFixed(1)}%`);
      console.log(`  Time:      ${ctx.time.iso}`);
      console.log(`  Power:     ${ctx.power.onBattery ? 'battery' : 'ac'}${ctx.power.batteryPercent != null ? ` (${ctx.power.batteryPercent}%)` : ''}`);
      console.log();
      console.log(chalk.bold(`  ${firing.length} of ${rulesArr.length} rules firing:`));
      for (const r of firing) console.log(chalk.green(`    \u2713 ${r.id}`));
      for (const r of rulesArr) if (!firing.includes(r)) console.log(chalk.dim(`    \u2013 ${r.id}`));
      console.log();
      return;
    }

    // Default: list
    console.log();
    console.log(chalk.bold.cyan('  Rules'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(50)));
    if (rulesArr.length === 0) {
      console.log(chalk.dim('  No rules configured.'));
      console.log(chalk.dim('  Add one: aiclean rules --add'));
      console.log();
      return;
    }
    for (const r of rulesArr) {
      console.log();
      console.log(`  ${chalk.bold(r.id)}`);
      console.log(chalk.gray(`    when: ${JSON.stringify(r.when)}`));
      console.log(chalk.gray(`    do:   ${JSON.stringify(r.do)}`));
    }
    console.log();
  });

// ━━━ DAEMON COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('daemon')
  .description('Manage the aiclean background daemon (runs rules on a schedule)')
  .argument('[action]', 'install | uninstall | status | tick', 'status')
  .option('--interval <minutes>', 'Tick interval in minutes', '15')
  .action(async (action, options) => {
    if (action === 'tick') {
      // Called by launchd/systemd — no user interaction.
      const cfg = await configLoader.load();
      const rulesArr = Array.isArray(cfg.rules) ? cfg.rules : [];
      if (rulesArr.length === 0) return;
      try {
        const scanResult = await engine.scan();
        const ctx = await rules.buildContext({ scanResult });
        const firing = rules.evaluate(rulesArr, ctx);
        // Fleet reporter heartbeat (if enrolled)
        await reporter.heartbeat({ scanResult, diskInfo: ctx.disk }).catch(() => {});
        const { execSync: es } = require('child_process');
        for (const r of firing) {
          if (r.do?.action === 'clean') {
            const args = ['clean', '--yes'];
            if (r.do.risk) { args.push('--risk', r.do.risk); }
            if (r.do.only) { args.push('--only', r.do.only); }
            try { es(`aiclean ${args.join(' ')}`, { stdio: 'pipe' }); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      return;
    }

    await requirePro('smart rules engine (aiclean daemon)');

    if (action === 'install') {
      const interval = parseInt(options.interval, 10) || 15;
      const r = await rules.installDaemon({ intervalMinutes: interval });
      console.log();
      if (r.success) {
        console.log(chalk.green(`  Daemon installed (${r.backend}) \u2014 tick every ${interval}m`));
        console.log(chalk.dim(`  ${r.path}`));
      } else {
        console.log(chalk.red(`  Install failed: ${r.reason}`));
      }
      console.log();
      return;
    }

    if (action === 'uninstall') {
      const r = await rules.uninstallDaemon();
      console.log(r.success ? chalk.green('\n  Daemon uninstalled.\n') : chalk.red(`\n  ${r.reason}\n`));
      return;
    }

    // status
    const s = await rules.daemonStatus();
    console.log();
    console.log(chalk.bold.cyan('  Daemon Status'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    console.log(`  Installed:  ${s.installed ? chalk.green('yes') : chalk.dim('no')}`);
    if (s.loaded !== undefined) console.log(`  Loaded:     ${s.loaded ? chalk.green('yes') : chalk.dim('no')}`);
    if (s.active !== undefined) console.log(`  Active:     ${s.active ? chalk.green('yes') : chalk.dim('no')}`);
    if (s.path) console.log(chalk.dim(`  Path:       ${s.path}`));
    if (s.logPath) console.log(chalk.dim(`  Log:        ${s.logPath}`));
    console.log();
  });

// ━━━ REGISTRY COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('registry')
  .description('Manage the live signed adapter registry')
  .argument('[action]', 'refresh | status | clear | verify', 'status')
  .action(async (action) => {
    if (action === 'refresh') {
      await requirePro('live adapter registry (aiclean registry)');
      const token = await apiClient.getToken();
      const sp = ora({ text: 'Fetching signed manifest...', color: 'cyan' }).start();
      const r = await registryFetch.refresh({ token });
      sp.stop();
      console.log();
      if (r.success) {
        console.log(chalk.green(`  Registry updated to v${r.version}`));
        console.log(chalk.dim(`  ${r.definitionCount} definitions, ${r.advisoryCount} advisories`));
      } else {
        console.log(chalk.red(`  Refresh failed (${r.source}): ${r.reason}`));
      }
      console.log();
      return;
    }

    if (action === 'clear') {
      await registryFetch.clear();
      console.log(chalk.green('\n  Registry cache cleared.\n'));
      return;
    }

    // status
    const s = await registryFetch.status();
    console.log();
    console.log(chalk.bold.cyan('  Registry Status'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    if (!s.installed) {
      console.log(chalk.dim('  No live registry installed.'));
      console.log(chalk.dim('  Using baked-in definitions.'));
      console.log();
      console.log(chalk.dim('  Refresh with: aiclean registry refresh (Pro)'));
    } else {
      console.log(`  Version:       ${s.version}`);
      console.log(`  Fetched:       ${new Date(s.fetchedAt).toLocaleString()} (${s.ageDays}d ago)`);
      console.log(`  Definitions:   ${s.definitionCount}`);
      console.log(`  Advisories:    ${s.advisoryCount}`);
      console.log(`  Stale:         ${s.stale ? chalk.yellow('yes') : chalk.green('no')}`);
    }
    console.log();
  });

// ━━━ AGENT COMMAND (Pro/Team) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('agent')
  .description('Enroll this machine with the fleet dashboard (Pro/Team)')
  .argument('[action]', 'enroll | unenroll | status', 'status')
  .option('--org-token <token>', 'Team org enrollment token')
  .action(async (action, options) => {
    if (action === 'enroll') {
      await requirePro('fleet / team dashboard (aiclean agent)');
      const sp = ora({ text: 'Enrolling device...', color: 'cyan' }).start();
      const r = await reporter.enroll({ orgToken: options.orgToken });
      sp.stop();
      console.log();
      if (r.success) {
        console.log(chalk.green(`  Enrolled as device ${r.deviceId}`));
        if (r.orgId) console.log(chalk.dim(`  Org: ${r.orgId}`));
        console.log(chalk.dim('  Metrics will be reported on each daemon tick.'));
      } else {
        console.log(chalk.red(`  Enroll failed: ${r.reason}`));
      }
      console.log();
      return;
    }

    if (action === 'unenroll') {
      await reporter.unenroll();
      console.log(chalk.green('\n  Device unenrolled.\n'));
      return;
    }

    const s = await reporter.agentStatus();
    console.log();
    console.log(chalk.bold.cyan('  Agent Status'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(40)));
    if (!s.enrolled) {
      console.log(chalk.dim('  Not enrolled.'));
      console.log(chalk.dim('  Enroll with: aiclean agent enroll'));
    } else {
      console.log(`  Device id:  ${s.deviceId}`);
      console.log(`  Enrolled:   ${new Date(s.enrolledAt).toLocaleString()}`);
      if (s.orgId) console.log(`  Org:        ${s.orgId}`);
    }
    console.log();
  });

// ━━━ BENCHMARK COMMAND (Pro) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

program
  .command('benchmark')
  .alias('bench')
  .description('Compare your usage against anonymized aggregates from other devs')
  .action(async () => {
    await requirePro('benchmarks (aiclean benchmark)');

    const sp = ora({ text: 'Scanning + fetching benchmarks...', color: 'cyan' }).start();
    const [scanResult, bench] = await Promise.all([
      engine.scan(),
      reporter.fetchBenchmarks(),
    ]);
    sp.stop();

    if (!bench.success) {
      console.log(chalk.red(`\n  Benchmark fetch failed: ${bench.reason}\n`));
      return;
    }

    console.log();
    console.log(chalk.bold.cyan('  You vs the fleet'));
    console.log(chalk.gray('  ' + '\u2500'.repeat(55)));
    const nonEmpty = (scanResult.results || []).filter((r) => r.total > 0);
    for (const r of nonEmpty) {
      const b = bench.benchmarks[r.id];
      if (!b || !b.n) continue;
      const ratio = b.p50 > 0 ? r.total / b.p50 : 0;
      let tag = chalk.green('normal');
      if (ratio > 3) tag = chalk.red('outlier (3\u00d7 p50)');
      else if (ratio > 1.5) tag = chalk.yellow('above p50');
      else if (ratio < 0.5) tag = chalk.dim('below p50');
      console.log(`  ${r.name.padEnd(22)} you=${formatSize(r.total).padStart(8)}  p50=${formatSize(b.p50).padStart(8)}  p90=${formatSize(b.p90).padStart(8)}  ${tag}`);
    }
    console.log();
    console.log(chalk.dim('  Based on anonymized opt-in reports from aiclean users.'));
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
