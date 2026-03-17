# `@healthybob/cli`

Owns the `vault-cli` command surface. The CLI may validate inputs and format outputs, but it must delegate all canonical writes to core.

## Status

- Package-local Incur command structure is present under `src/`.
- Command handlers are thin and dependency-injected through `createVaultCli()`.
- Machine-facing callers should rely on Incur's native envelope via `--verbose --format json` instead of a Healthy Bob-specific wrapper contract.
- Built-in Incur surfaces such as `--help`, `--schema`, `--llms`, and `completions bash` are part of the package verification surface and should remain truthful as command metadata evolves.
- Library exports and the executable bin are now split: `src/index.ts` is the package entrypoint, and `src/bin.ts` is the CLI launcher.
- Default runtime services now lazy-load the workspace `@healthybob/core`, `@healthybob/importers`, and `@healthybob/query` package boundaries instead of reaching into sibling `src/` trees.
- `packages/cli` now extends the shared `../../tsconfig.base.json`; `tsconfig.json` is the buildable package project, `tsconfig.build.json` stays as the local build alias, and `tsconfig.typecheck.json` covers package-local scripts and tests.
- Package-local verification scripts and runtime tests now live in TypeScript under `scripts/` and `test/`.
- Local build now runs in this workspace, and the built binary can be exercised with `node dist/bin.js ...` after `pnpm --dir packages/cli build`.
- Top-level retrieval commands now include `search` for lexical read-model search, `search index status` / `search index rebuild` for the optional SQLite FTS index stored in `.runtime/search.sqlite`, and `timeline` for descending journal/event/sample-summary context, with the query package boundary isolated in `src/query-runtime.ts`.
- The inbox CLI runtime now resolves `.runtime` paths through `@healthybob/runtime-state`, so inbox config/state/promotions JSON and `inboxd.sqlite` stay aligned with inboxd itself.
- The CLI now also owns an `inbox` command group for local runtime init/source management, diagnostics, backfill, foreground daemon control, and inbox capture review/promotion via `src/inbox-services.ts`.
- The CLI now also owns an `assistant` command group for provider-backed local chat turns, Ink-backed local chat UI fallback, assistant-session metadata outside the vault, outbound channel delivery, and an always-on inbox triage loop via `src/assistant-runtime.ts`.
- The built CLI package shape exposes both `vault-cli` and a setup-focused `healthybob` alias from the same entrypoint; `healthybob`, `healthybob --help`, and `healthybob setup ...` land on the setup surface, while other operator/data-plane commands stay under `vault-cli`.

## macOS setup

Once `@healthybob/cli` is publish-ready, the installed-package onboarding path will be:

```bash
healthybob setup --vault ./vault
```

That command installs or reuses the Homebrew-based local parser dependencies (`ffmpeg`, `poppler`/`pdftotext`, `whisper-cpp`), downloads a Whisper model into `~/.healthybob/toolchain/models/whisper/`, optionally installs PaddleX OCR on Apple Silicon, initializes the target vault, and then runs inbox bootstrap so the machine is ready for local ingestion out of the box.

Setup also installs user-level `healthybob` and `vault-cli` shims into `~/.local/bin`. If that directory is not already on `PATH`, setup appends a managed PATH block to the active shell profile and tells the operator to reload the shell.

Useful flags include `--dry-run`, `--whisperModel small.en`, and `--skipOcr`.

Today the supported onboarding path is still the repo-local `scripts/setup-macos.sh` wrapper, because `pnpm release:check` intentionally blocks npm publish while `@healthybob/cli` still depends on `workspace:*` packages. The wrapper is macOS-only, and `./scripts/setup-macos.sh --dry-run ...` now prints the wrapper bootstrap plan without mutating Homebrew, Node, pnpm, dependencies, or the workspace build. A successful non-dry-run setup now leaves behind working `healthybob` and `vault-cli` commands for future shells via those user-level shims.

## Release Flow

Release/version/publish actions remain user-operated. Root convenience commands proxy into `packages/cli`, so the normal release entrypoints are:

```bash
pnpm release:check
pnpm release:patch   # or: pnpm release:minor / pnpm release:major
```

Pre-release and exact-version flows use the same package-scoped script:

```bash
bash scripts/release.sh preminor --preid alpha
bash scripts/release.sh 0.1.0-rc.1 --dry-run
```

The release flow only mutates `packages/cli/package.json`, `packages/cli/CHANGELOG.md`, and `packages/cli/release-notes/`, then creates a repository tag so `.github/workflows/release.yml` can pack and publish the CLI tarball.

`pnpm release:check` currently includes a publish-readiness guard that refuses to release while `@healthybob/cli` still depends on `workspace:*` packages. That guard is intentional: it blocks a broken npm publish until the internal package graph is publishable.
