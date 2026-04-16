# aiclean GitHub Action

Reclaim disk on GitHub Actions runners (self-hosted or GitHub-hosted) before you run out of space mid-build. Works with Docker layer cache, npm, pip, cargo, Gradle, Maven, HuggingFace, Ollama, and everything else aiclean supports.

> This lives inside the main aiclean repo for now. To publish to the Marketplace, extract this directory into its own repo (e.g. `Prashant-123/aiclean-action`) and tag a release.

## Usage

```yaml
- uses: Prashant-123/aiclean-action@v1
  with:
    risk: medium
    only: docker,npm,huggingface
    license-key: ${{ secrets.AICLEAN_LICENSE_KEY }}
    license-email: ${{ secrets.AICLEAN_LICENSE_EMAIL }}
```

## Inputs

| Name | Default | Description |
|---|---|---|
| `risk` | `medium` | Max risk level: `low` / `medium` / `high` |
| `only` | — | Comma-separated tool IDs to clean |
| `exclude` | — | Comma-separated tool IDs to skip |
| `older-than` | — | Only clean files not accessed in `30d`, `2w`, `6h` (Pro) |
| `license-key` | — | aiclean Pro license key (enables `--older-than` + live registry) |
| `license-email` | — | Email associated with the license |
| `report` | `true` | PR comment with reclaimed size on pull_request events |
| `fail-on-error` | `false` | Fail the step if any clean error occurred |

## Outputs

| Name | Description |
|---|---|
| `reclaimed` | Bytes reclaimed (human-readable) |
| `reclaimed-human` | Same as `reclaimed` |

## Example: pre-build disk reclaim on a PR

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Prashant-123/aiclean-action@v1
        with:
          risk: medium
          only: docker,npm
      - run: docker build .
```

## Why

CI runners (especially self-hosted ones) accumulate gigabytes of:

- Docker layer cache that never gets garbage-collected
- `node_modules` from every branch
- Gradle dependency caches from years of builds
- Orphaned HuggingFace / Ollama partial downloads

`aiclean` knows where all of them live and which are safe to delete.
