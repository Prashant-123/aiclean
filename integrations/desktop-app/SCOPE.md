# aiclean desktop app — scoping notes (Phase 4, not yet built)

This file intentionally documents *what the desktop app is for* and *what shipping it requires*, so we don't accidentally start building it out of sequence.

## Who it's for

Not most devs. CLI users are fine in terminal. The desktop app exists for:

- **Mac-native ML/AI engineers** who live in Jupyter and HuggingFace, rarely open Terminal, and have the biggest disk bloat (50+ GB HF caches, 100+ GB Ollama models).
- **Non-CLI designers / PMs** at companies where the platform-eng team enrolls Pro fleet seats — they shouldn't need to `curl | bash`.

## What it does

- Lives in the macOS menu bar (and Linux system tray / Windows later).
- Shows reclaimable disk live (updates every N minutes via the aiclean daemon).
- One-click "clean low-risk now".
- Surfaces insights & advisories as native macOS notifications.
- Provides a GUI wrapper around: `scan`, `clean` (with risk-tier UI), `dedupe`, `projects`, `restore`, `registry`, `agent status`.
- **Does NOT reimplement any logic** — it shells out to the same `aiclean` CLI binary. That way the Pro moat stays in the CLI+backend.

## Tech choice

**Tauri** (Rust + web frontend) recommended over Electron:
- 10–20× smaller binary (4 MB vs 80–120 MB).
- Native file picker, native notifications, native menu bar out of the box.
- Same web stack as the landing page — we can reuse Tailwind classes and some React components.

Frontend: React + TypeScript + Tailwind (same palette as aiclean.tech).

## Gating this correctly

The menu-bar app itself is FREE — it's a better install experience. Gated features inside it (fleet dashboard view, live registry status, dedupe UI) use the same `requirePro()` pattern, just rendered as dialogs instead of CLI prompts.

## Prerequisites before we build

1. Apple Developer Program membership ($99/yr) — for code-signing + notarization. Without this, users get a scary "unidentified developer" warning.
2. A separate repo: `Prashant-123/aiclean-desktop`. This is not a CLI dependency; it's a standalone product.
3. An auto-update channel (tauri-plugin-updater → signed release feed hosted on GitHub Releases or S3).
4. A logo / icon set (SVG + .icns + .ico).
5. A dmg / msi / AppImage release pipeline (tauri-action handles this).

## Non-goals for v1

- Not a disk visualizer. GrandPerspective / DaisyDisk already own that space.
- Not a file manager. People have Finder.
- Not a replacement for the CLI. Power users still live in Terminal; the GUI is for everyone else.

## Suggested rollout order

1. Ship CLI v2.0 + website + backend.
2. Wait 4–8 weeks; collect usage data on `aiclean dedupe` and `aiclean guard` (the two most GUI-friendly features).
3. Scaffold the Tauri app with just **one** feature: live menu-bar reclaim indicator. Ship as a v0.1 beta to existing Pro users only.
4. Iterate based on feedback — add fleet enrollment UI, dedupe UI, etc.
5. Public launch at v1.0.

Building this now would dilute focus while the CLI/backend/website are brand new. Queue it up; don't start.
