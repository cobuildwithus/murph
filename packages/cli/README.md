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

For durable local synthesis that should keep adding up inside the vault, use the derived knowledge wiki commands:

```bash
vault-cli knowledge compile "Summarize my current sleep notes" --source-path research/2026/04/sleep-note.md
vault-cli knowledge search "sleep magnesium"
vault-cli knowledge list
vault-cli knowledge lint
```

## What you get

- a file-native health vault with canonical writes owned by `@murphai/core`
- local assistant chat, automation, status, cron, and outbox commands
- a non-canonical derived knowledge wiki you can compile and inspect under `derived/knowledge/**`
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

## Maintainer notes

The package exports the CLI runtime plus assistant helper subpaths from `dist/**`, exposes both `murph` and `vault-cli` bins from the same built entrypoint, and keeps `src/index.ts` as the package entrypoint with `src/bin.ts` as the launcher.

Machine-facing callers should rely on incur's native envelope via `--verbose --format json` instead of a Murph-specific wrapper contract.

Current repo-local package responsibilities include:

- the command graph and onboarding flow
- local assistant command orchestration and Ink chat UI
- inbox and device command surfaces that delegate to headless owner packages
- CLI-only wrappers around shared packages such as `@murphai/assistant-core`, `@murphai/query`, `@murphai/inboxd`, and `@murphai/runtime-state`

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
