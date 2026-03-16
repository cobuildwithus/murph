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
- The published package now exposes both `vault-cli` and a setup-focused `healthybob` alias from the same entrypoint; `healthybob setup` provisions the macOS local parser/runtime toolchain before handing off to the existing inbox bootstrap flow.

## macOS setup

For an installed CLI package, the fastest onboarding path is:

```bash
healthybob setup --vault ./vault
```

That command installs or reuses the Homebrew-based local parser dependencies (`ffmpeg`, `poppler`/`pdftotext`, `whisper-cpp`), downloads a Whisper model into `~/.healthybob/toolchain/models/whisper/`, optionally installs PaddleX OCR on Apple Silicon, initializes the target vault, and then runs inbox bootstrap so the machine is ready for local ingestion out of the box.

Useful flags include `--dryRun`, `--whisperModel small.en`, and `--skipOcr`. When working from a fresh repository checkout instead of an installed package, use the root `scripts/setup-macos.sh` wrapper first so Node, pnpm, dependencies, and the workspace build are present before the setup command runs.

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
