# Murph - Personal Health Assistant

Murph is your personal health assistant.

Install this package to get the main `murph` command and the full local Murph experience: onboarding, vault setup, local assistant chat, inbox capture, parser tooling, and the always-on assistant loop.

The repo implementation happens to live in `packages/cli`, but that is a maintainer detail. For users, `@murphai/murph` is the installable Murph package.

[Repository](https://github.com/cobuildwithus/murph) · [Architecture](https://github.com/cobuildwithus/murph/blob/main/ARCHITECTURE.md) · [Hosted control plane](https://github.com/cobuildwithus/murph/blob/main/apps/web/README.md) · [Hosted execution](https://github.com/cobuildwithus/murph/blob/main/apps/cloudflare/README.md)

If you want a local, inspectable assistant that keeps durable truth in normal files you can read, this is the package you install.

Runtime: Node `>= 22.16.0`.

Supported host setup path: macOS and Linux. iMessage remains macOS-only.

## Install

```bash
npm install -g @murphai/murph@latest
# or
pnpm add -g @murphai/murph@latest
```

## Quick start

```bash
murph onboard
```

`murph onboard` installs or reuses the local parser dependencies, initializes a vault, saves that vault as the default Murph vault for later commands, and walks through assistant, channel, and optional wearable setup.

Once setup is complete, the main commands are:

```bash
murph chat
murph run
murph status
vault-cli inbox doctor
```

`vault-cli` is still available as a secondary alias for the operator surface, but `murph` is the primary command this package installs.

## OpenClaw

If you already run OpenClaw, install the first-party Murph bundle after `murph onboard`:

```bash
openclaw plugins install @murphai/openclaw-plugin
openclaw gateway restart
```

That bundle teaches OpenClaw to call `vault-cli` directly against the same configured vault. It does not create a second Murph assistant runtime inside OpenClaw.

When you need to read from the vault, use this chooser:

- `vault-cli show <id>` for one exact canonical read id, including stable family ids such as `meal_*` or `doc_*`
- `vault-cli list` for structured filtering by family, kind, status, stream, tag, or date range
- `vault-cli search query --text "..."` for fuzzy recall or remembered phrases
- `vault-cli timeline` for chronology across journals, events, assessments, profile snapshots, and sample summaries
- `vault-cli profile show current` for the current synthesized profile
- `vault-cli wearables day` or `wearables ... list` for semantic wearable summaries
- family `manifest` commands for immutable import provenance

For durable local synthesis that should keep adding up inside the vault, use the derived knowledge wiki commands:

```bash
vault-cli knowledge upsert --title "Sleep notes" --body "# Sleep notes\n\nMagnesium looked helpful for sleep continuity.\n" --source-path research/2026/04/sleep-note.md
vault-cli knowledge search "sleep magnesium"
vault-cli knowledge list
vault-cli knowledge lint
```

## What you get

- a file-native health vault with canonical writes owned by `@murphai/core`
- local assistant chat, runtime automation, status, outbox, canonical memory, and canonical automation commands
- a non-canonical derived knowledge wiki you can upsert and inspect under `derived/knowledge/**`
- inbox capture, review, backfill, and parser-driven attachment extraction
- optional local device sync through `@murphai/device-syncd`
- optional local assistant daemon support through `@murphai/assistantd`

`@murphai/murph` is the installable local Murph product entrypoint. The wider monorepo also contains hosted control and execution apps, but those are repo internals rather than something npm users need to install directly.

## From source

If you are developing from a checkout instead of installing the published package:

```bash
pnpm install --frozen-lockfile
pnpm onboard --vault ./vault
```

If `pnpm` is not available yet, use:

```bash
./scripts/setup-host.sh --vault ./vault
```

## Config defaults

The CLI supports incur's built-in config loading for command option defaults. By default it searches `~/.config/murph/config.json` and then `~/.config/vault-cli/config.json`.

- `murph --config <path> ...` selects an explicit config file
- `murph --no-config ...` disables config loading for a single run
- the published package now ships `config.schema.json` so editors can validate and autocomplete those config files

Config files only supply command `options`, following incur's nested `commands` shape. For example:

```json
{
  "commands": {
    "init": {
      "options": {
        "vault": "./vault"
      }
    }
  }
}
```

To refresh the shipped schema artifact from the built CLI entrypoint during package work:

```bash
pnpm --dir packages/cli gen:config-schema
```

## Maintainer notes

The package exports the CLI runtime plus assistant helper subpaths from `dist/**`, exposes both `murph` and `vault-cli` bins from the same built entrypoint, and keeps `src/index.ts` as the package entrypoint with `src/bin.ts` as the launcher.

Machine-facing callers should rely on incur's native envelope via `--verbose --format json` instead of a Murph-specific wrapper contract.

Current repo-local package responsibilities include:

- the published command graph and install surface
- CLI-owned command routing, onboarding entry, and built binary launchers
- inbox and device command surfaces that delegate to headless owner packages
- release ownership for the public `@murphai/murph` package and bins

Programmatic assistant, setup, and shared usecase APIs now publish from their owner packages directly: `@murphai/assistant-cli`, `@murphai/setup-cli`, `@murphai/assistant-engine`, `@murphai/operator-config`, and `@murphai/vault-inbox`. `@murphai/murph` no longer republishes those helper surfaces through local shim files.

## Release flow

Release and publish actions remain user-operated. The monorepo release source of truth is `scripts/release-manifest.json`, and the normal entrypoints are:

```bash
pnpm release:check
pnpm release:patch
```

Pre-release and exact-version flows use the same root script:

```bash
bash scripts/release.sh preminor --preid alpha
bash scripts/release.sh 0.1.0-rc.1 --dry-run
```

The release flow bumps every publishable package in the manifest to one shared version, updates `packages/cli/CHANGELOG.md`, writes `packages/cli/release-notes/v<version>.md`, and then creates a repository tag so `.github/workflows/release.yml` can pack and publish all tarballs in dependency order.

npm trusted publishing is configured per package on npm, not once per repository. Because this monorepo publishes multiple `@murphai/*` packages, maintainers should bootstrap those package-level trust bindings before relying on tag-driven release publication:

```bash
pnpm release:trust:github -- --dry-run
pnpm release:trust:github -- --yes
```

Those commands target the current publishable package set in `scripts/release-manifest.json` and bind each package to `cobuildwithus/murph` via `.github/workflows/release.yml`.

If a package is already bound to the wrong workflow or repository in npm, revoke that package's existing trust entry with `npm trust list` and `npm trust revoke`, then rerun `pnpm release:trust:github -- --yes`.
