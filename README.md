# aiclean

Reclaim disk space from **50+ AI & development tools** in one command.

Every AI tool you install silently hoards gigabytes of caches, models, and temp files. aiclean finds them all — and lets you take back your storage.

```bash
npm install -g aiclean
aiclean scan
```

## Why aiclean?

The average developer has **20-80 GB** of hidden cache files. npm alone caches 2-5 GB. Hugging Face models can hit 50+ GB. Gradle hoards 20+ GB of dependencies. Nobody cleans these. Nobody even knows where they are.

aiclean scans 51 tools across 8 categories, rates every cleanup by risk, and lets you reclaim your disk safely.

## Quick Start

```bash
# Install globally
npm install -g aiclean

# See what's eating your disk
aiclean scan

# Clean with confirmation prompts
aiclean clean

# Preview without deleting anything
aiclean clean --dry

# Interactive mode — pick what to clean
aiclean interactive
```

## Commands

| Command | Description |
|---------|-------------|
| `aiclean scan` | Scan disk usage across all tools |
| `aiclean clean` | Clean with tiered confirmation (low/med/high risk) |
| `aiclean clean --dry` | Preview what would be deleted |
| `aiclean clean --older-than 30d` | Only clean files older than 30 days (Pro) |
| `aiclean interactive` | Choose categories and tools step by step |
| `aiclean list` | List all 51 supported tools |
| `aiclean auto --weekly` | Schedule auto-clean via cron (Pro) |
| `aiclean auto --status` | Check if auto-clean is active |
| `aiclean auto --off` | Disable auto-clean |
| `aiclean config` | View/update configuration |
| `aiclean logs` | View cleaning history |
| `aiclean stats` | View usage statistics |
| `aiclean plan` | Show current account & plan status |
| `aiclean login` | Authenticate with API key |
| `aiclean logout` | Remove credentials |
| `aiclean unlock` | Force-release a stale clean lock |

### Filtering

```bash
aiclean scan --only claude,cursor       # Scan specific tools
aiclean scan --exclude docker,ollama    # Skip specific tools
aiclean scan --category "AI Tools"      # One category only
aiclean scan --json                     # JSON output for scripts
aiclean clean --risk low                # Only clean low-risk items
```

## Supported Tools (51)

### AI Tools
Claude Code, Cursor, GitHub Copilot, Windsurf (Codeium), Aider, Continue.dev, Cody (Sourcegraph), Tabnine, Amazon Q

### Editors & IDEs
VS Code, JetBrains (IntelliJ, PyCharm, WebStorm, GoLand, CLion, DataGrip, Rider, RubyMine, PhpStorm, RustRover, Aqua), Zed, Xcode, Android Studio, Sublime Text

### Package Managers
npm, Yarn, pnpm, pip, Conda, Poetry, Pipenv, Homebrew, CocoaPods, Ruby Gems

### Languages
Cargo (Rust), Go, Gradle, Maven, Python/Ruff

### Build Tools
Docker, Turborepo, Watchman, Metro Bundler

### Cloud & DevOps
AWS CLI, Google Cloud CLI, Kubernetes, Helm, Terraform, Vagrant

### ML Frameworks
Hugging Face, PyTorch, TensorFlow/Keras, Ollama, LM Studio

### System
System Temp, Trash, Google Chrome, Firefox, Safari, System Logs

## Safety

aiclean is built safety-first:

- **Risk levels** — every tool rated LOW / MED / HIGH with explanation
- **Tiered confirmation** — low-risk: batch confirm. Medium: grouped warning. High: individual per-tool approval
- **Dry run** — preview everything before deleting
- **Process detection** — warns if a tool is currently running
- **Lockfile** — prevents concurrent clean operations
- **Size warnings** — extra confirmation for large deletions (5 GB+)
- **Never touches** — config files, credentials, source code, or user data
- **Auto-clean safety** — only low-risk by default; high-risk never auto-cleaned

## Configuration

Stored at `~/.aicleanrc`:

```json
{
  "autoClean": false,
  "interval": "weekly",
  "ignoredTools": [],
  "dryRunByDefault": false,
  "logCleaning": true,
  "telemetry": true,
  "confirmBeforeClean": true,
  "showInsights": true
}
```

## Free vs Pro

The CLI is **free and open source**. All scan, clean, interactive, and safety features work without an account.

Pro ($5/month) adds:
- Scheduled auto-clean (`aiclean auto --weekly`)
- Age-based cleaning (`aiclean clean --older-than 30d`)
- Priority support
- Early access to new features

Learn more at [aiclean.tech](https://aiclean.tech/pricing)

## Contributing

We welcome contributions! Here's how to get started:

### Setting up the dev environment

```bash
git clone https://github.com/aiclean/aiclean.git
cd aiclean
npm install
```

### Running locally

```bash
# Run any command directly
node bin/index.js scan
node bin/index.js clean --dry

# Or link globally for testing
npm link
aiclean scan
```

### Adding a new tool

1. Find the cache paths for the tool on macOS and Linux
2. Add a definition to the appropriate file in `adapters/definitions/`
3. Each definition needs: `id`, `name`, `category`, `risk`, `riskReason`, `processNames`, `description`, `paths`
4. Test with `node bin/index.js scan --only your-tool-id`

Example definition:

```js
{
  id: 'mytool',
  name: 'My Tool',
  category: 'AI Tools',
  risk: 'low',
  riskReason: 'Pure cache — rebuilt automatically',
  processNames: ['mytool'],
  description: 'My Tool caches and logs',
  paths: {
    darwin: [
      { name: 'cache', path: '~/.cache/mytool' },
    ],
    linux: [
      { name: 'cache', path: '~/.cache/mytool' },
    ],
  },
}
```

### Guidelines

- **Test on your own machine** before submitting — run `scan` and `clean --dry` to verify paths exist and sizes are correct
- **Verify paths are safe** — only cache/temp/log directories, never config or user data
- **Set the right risk level** — `low` for pure caches, `medium` for package caches that slow rebuilds, `high` for large downloads (models, VMs) that take a long time to re-acquire
- **Add process names** — so we can warn users if the tool is running during clean
- **No overlapping paths** — if a parent directory is listed, don't also list its children

### Submitting changes

1. Fork the repository
2. Create a feature branch: `git checkout -b add-mytool-support`
3. Make your changes
4. Test: `node bin/index.js scan` and `node bin/index.js clean --dry`
5. Submit a pull request with a description of what tool you added and how you verified the paths

### Reporting bugs

Open an issue at [github.com/aiclean/aiclean/issues](https://github.com/aiclean/aiclean/issues) with:
- Your OS and version
- Node.js version (`node --version`)
- The command you ran
- The error output

## Architecture

```
aiclean/
├── bin/index.js              CLI entry (all commands + safeguards)
├── core/
│   ├── engine.js             Orchestrator
│   ├── scanner.js            Scan engine with insights
│   ├── cleaner.js            Clean engine with logging
│   └── registry.js           Adapter registry (auto-populates)
├── adapters/
│   ├── base.js               Adapter factory (DRY — one function creates all adapters)
│   └── definitions/          Tool definitions by category (add new tools here)
├── config/                   Config system (~/.aicleanrc)
├── utils/                    Size, logging, platform, safety, auth utilities
├── telemetry/                Local usage statistics
└── api/                      API client for aiclean.tech
```

## License

MIT — see [LICENSE](LICENSE)
