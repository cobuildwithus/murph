# `murph` (`packages/cli`)

Owns the `vault-cli` command surface. The CLI may validate inputs and format outputs, but it must delegate all canonical writes to core.

## Status

- Package-local Incur command structure is present under `src/`.
- Command handlers are thin and dependency-injected through `createVaultCli()`.
- Machine-facing callers should rely on Incur's native envelope via `--verbose --format json` instead of a Murph-specific wrapper contract.
- Built-in Incur surfaces such as `--help`, `--schema`, `--llms`, and `completions bash` are part of the package verification surface and should remain truthful as command metadata evolves.
- Library exports and the executable bin are now split: `src/index.ts` is the package entrypoint, and `src/bin.ts` is the CLI launcher.
- Default runtime services now lazy-load the workspace `@murph/core`, `@murph/importers`, and `@murph/query` package boundaries instead of reaching into sibling `src/` trees.
- `packages/cli` now extends the shared `../../tsconfig.base.json`; `tsconfig.json` is the buildable package project, `tsconfig.build.json` stays as the local build alias, and `tsconfig.typecheck.json` covers package-local scripts and tests.
- Package-local verification scripts and runtime tests now live in TypeScript under `scripts/` and `test/`.
- Local build now runs in this workspace, and the built binary can be exercised with `node dist/bin.js ...` after `pnpm --dir packages/cli build`.
- Top-level retrieval commands now include `search` for lexical read-model search, `search index status` / `search index rebuild` for the optional SQLite FTS index stored in `.runtime/search.sqlite`, and `timeline` for descending journal/event/sample-summary context, with the query package boundary isolated in `src/query-runtime.ts`.
- The inbox CLI runtime now resolves `.runtime` paths through `@murph/runtime-state`, so inbox config/state/promotions JSON and `inboxd.sqlite` stay aligned with inboxd itself.
- The CLI now also owns an `inbox` command group for local runtime init/source management, diagnostics, backfill, foreground daemon control, and inbox capture review/promotion via `src/inbox-services.ts`.
- The CLI now also owns an `assistant` command group for provider-backed local chat turns, Ink-backed local chat UI fallback, assistant-session metadata plus local transcripts outside the vault, outbound channel delivery, and an always-on inbox triage loop via `src/assistant-runtime.ts`.
- iMessage-backed inbox and assistant delivery flows now depend directly on `@photon-ai/imessage-kit` instead of late-loading that package at call time, while Telegram delivery and ingestion share the same assistant channel binding abstraction.
- The built CLI package shape exposes both `vault-cli` and a setup-focused `murph` alias from the same entrypoint; `murph`, `murph --help`, and `murph setup ...` land on the setup surface, while other operator/data-plane commands stay under `vault-cli`.

## Host setup (macOS and Linux)

Once `murph` is published, the installed-package onboarding path will be:

```bash
murph setup
```

That command installs or reuses the local parser dependencies (`ffmpeg`, `poppler`/`pdftotext`, `whisper-cpp`), downloads a Whisper model into `~/.murph/toolchain/models/whisper/`, initializes the default `./vault` target unless you override it, saves that vault as the default Murph CLI vault for later commands, runs inbox bootstrap, and then launches `assistant run` automatically when at least one selected channel is fully configured for auto-reply, falling back to `assistant chat` otherwise.

Setup also installs user-level `murph` and `vault-cli` shims into `~/.local/bin`. If that directory is not already on `PATH`, setup appends a managed PATH block to the active shell profile and tells the operator to reload the shell. Once setup has run, the main CLI can omit `--vault` when the saved default is the intended target.

Useful flags include `--dry-run` and `--whisperModel small.en`.

From a checkout, the supported onboarding path is the repo-local `scripts/setup-host.sh` wrapper. On macOS it delegates to the existing Homebrew-based bootstrap path; on Linux it can reuse or download Node locally, activate pnpm through corepack, install dependencies, build the workspace, and then run the same CLI setup flow. `./scripts/setup-host.sh --dry-run ...` now prints the wrapper bootstrap plan without mutating Homebrew, Node, pnpm, dependencies, or the workspace build. A successful non-dry-run setup now leaves behind working `murph` and `vault-cli` commands for future shells via those user-level shims. iMessage remains macOS-only even though the rest of the host setup now supports Linux.

## Release Flow

Release/version/publish actions remain user-operated. The monorepo release source of truth is `scripts/release-manifest.json`, and the normal entrypoints are root commands:

```bash
pnpm release:check
pnpm release:patch   # or: pnpm release:minor / pnpm release:major
```

Pre-release and exact-version flows use the same root script:

```bash
bash scripts/release.sh preminor --preid alpha
bash scripts/release.sh 0.1.0-rc.1 --dry-run
```

The release flow bumps every publishable package in the manifest to one shared version, updates `packages/cli/CHANGELOG.md`, writes `packages/cli/release-notes/v<version>.md`, and then creates a repository tag so `.github/workflows/release.yml` can pack and publish all tarballs in dependency order.

The first publish set is:

- `@murph/contracts`
- `@murph/runtime-state`
- `@murph/core`
- `@murph/query`
- `@murph/importers`
- `@murph/inboxd`
- `@murph/parsers`
- `murph`

`pnpm release:check` now installs with the frozen lockfile, builds the workspace, runs the repo checks, verifies that every workspace dependency in the publish set stays inside the publish set, and packs every publishable package with `pnpm pack`.

Trusted publishing still has to be configured on npm for each published package entry that this workflow will publish.
