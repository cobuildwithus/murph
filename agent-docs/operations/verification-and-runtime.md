# Verification And Runtime

Last verified: 2026-03-17

## Verification Matrix

| Change scope | Required commands | Notes |
| --- | --- | --- |
| Docs/process-only | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Includes package-runtime checks, built CLI verification, and fixture/scenario scaffolding because those are part of repo truth now. |
| Fixture/e2e/package-doc changes | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Verifies fixture corpus integrity, smoke-manifest wiring, package-runtime health, built CLI checks, command-surface coverage, and the source-artifact guard for handwritten JS-like files plus tracked build residue under `packages/` and `e2e/`. |
| Changes under `packages/contracts`, `packages/runtime-state`, `packages/core`, `packages/importers`, `packages/inboxd`, `packages/parsers`, or `packages/query` | `pnpm typecheck`, `pnpm test:packages`, `pnpm test:smoke` | `pnpm test` remains required for full repo acceptance, but `pnpm test:packages` is the clean runtime signal when the doc-drift wrapper is blocked by an in-progress dirty worktree. `pnpm test:packages:coverage` is the matching Vitest/V8 signal when the change should hold the CLI-style per-file thresholds for the currently included `core`/`importers`/`query` surface; inbox/parser tests still execute under coverage, but their source files are not yet in the thresholded include list. |
| Changes under `packages/web` | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Repo checks now include package-local web typecheck plus a focused web Vitest fixture pass and a Next.js webpack production build under `packages/web test`. The web package currently builds `packages/query` first and consumes the query read layer without write access. |
| Changes under `packages/cli` | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Repo checks now run `packages/cli` typecheck plus package-local verification through `pnpm verify:cli`, and package tests build any required workspace dependencies, including `@healthybob/inboxd`, before exercising the CLI. CLI runtime tests still execute through the built package path, so source coverage remains focused on the in-process `core`/`importers`/`query` runtime modules. Assistant provider and outbound channel tests use mocks/stubs and do not execute live Codex, Ollama, gateway, or iMessage sends in repo automation. |
| User explicitly says to skip checks | Skip checks for that turn only. | User instruction takes precedence. |

## Current Command Meaning

- `pnpm build`: executes the solution-style `tsc -b` build across the workspace package graph, with `packages/contracts` library emit ordered through `packages/contracts/tsconfig.build.json`, `packages/runtime-state` shared-runtime helpers built before query, inboxd, and CLI consumers, and downstream runtime packages, including `packages/parsers`, resolved through project references.
- `pnpm typecheck`: validates shell syntax, typechecks repo-owned TS tools, runs each package’s local no-emit typecheck script, and verifies the shared `tsc -b` build, including `packages/runtime-state`, `packages/inboxd`, `packages/parsers`, and the web package’s local typecheck.
- `pnpm test`: runs docs drift enforcement, package verification for `contracts`/`runtime-state`/`cli`/`core`/`importers`/`inboxd`/`parsers`/`query`/`web`, and fixture/scenario integrity verification through `e2e/smoke/verify-fixtures.ts`.
- `pnpm test:packages`: runs executable runtime package checks plus the built CLI verification path, executes `packages/web test` (focused web Vitest fixture plus Next.js webpack build), then executes the root Vitest suite with `--no-coverage`, including parser-layer tests discovered under `packages/parsers/test/**`.
- `pnpm test:packages:coverage`: runs the same package-runtime path, including `packages/web test`, then executes the root Vitest suite with deterministic single-file execution and V8 coverage using the sibling CLI thresholds (`perFile`, `lines/functions/statements=85`, `branches=80`) over the targeted `core`/`importers`/`query` source surface, including `packages/query/src/search-sqlite.ts`, while inbox/parser tests still execute under coverage.
- `pnpm test:coverage`: runs doc-gardening validation, `pnpm test:packages:coverage`, verifies every documented baseline command has smoke coverage plus a golden-output scaffold, and fails if handwritten `.js`, `.mjs`, `.cjs`, or `.d.ts` source files remain under `packages/` or `e2e/` aside from the framework-generated `packages/web/next-env.d.ts` allowlist, or if tracked `dist/`, `.next/`, `.test-dist/`, or `*.tsbuildinfo` residue is committed there.
- `pnpm test:smoke`: runs only the fixture/scenario integrity verifier.

## Incur-Backed CLI Guardrails

- Model nested CLI verbs with real incur router groups. Do not use argv rewrites or synthetic action args to mimic nested commands, because `--schema`, `--llms`, `skills add`, and command-map typegen only stay truthful when the router tree itself is truthful.
- Treat incur-owned transport and discovery features as framework behavior: `--format`, `--json`, `--verbose`, `--schema`, `--llms`, `skills add`, and `--mcp`. Command-surface docs should describe Healthy Bob semantics and payloads, not restate incur defaults command-by-command unless the repo is deliberately constraining them.
- Keep `packages/cli/src/index.ts` default-exporting the root CLI and refresh `packages/cli/src/incur.generated.ts` whenever command topology changes. If `incur gen` is blocked by an unrelated build failure, record that explicitly in the handoff instead of silently leaving stale generated types.
- `packages/cli/test/cli-test-helpers.ts` executes `packages/cli/dist/bin.js`, so source checks like `pnpm exec tsx packages/cli/src/bin.ts ...` are only a diagnostic shortcut. Final verification still needs the built CLI path or a clearly documented unrelated blocker.

## Runtime Status

- No deployment target is defined yet.
- Repo-level checks execute canonical write/read paths in `core`, `importers`, `inboxd`, `parsers`, and `query`, build the shared `runtime-state` package, and build the CLI package through the same TypeScript workspace toolchain used for local development.
- Shared runtime-state helpers now own `.runtime` path resolution plus SQLite open defaults for query search, inboxd, and the CLI inbox layer.
- Query-owned lexical search state lives only at `.runtime/search.sqlite`; inbox-owned local state remains at `.runtime/inboxd.sqlite` plus `.runtime/inboxd/*.json`.
- `vault-cli inbox model bundle|route` can materialize capture-scoped audit artifacts under `derived/inbox/**/assistant/*.json`; those files are rebuildable and non-canonical.
- `vault-cli inbox model route` may call either the AI Gateway or an operator-supplied OpenAI-compatible endpoint. Automated repo checks do not execute live network model calls.
- `vault-cli assistant ask|chat|deliver|session` persist only minimal local session metadata under `assistant-state/`; provider transcript history and channel-native send history stay external when the adapter supports them.
- `vault-cli assistant chat` uses an Ink-based stderr UI and expects `react`, `ink`, and `ink-text-input` to be installed in the CLI workspace.
- The built `vault-cli` binary can be exercised locally with `node packages/cli/dist/bin.js ...` when a change requires an end-to-end runtime check beyond the standard repo scripts.
- A setup-specific entrypoint also exists at `node packages/cli/dist/bin.js setup ...`; it is routed from `packages/cli/src/bin.ts` instead of the main `vault-cli` manifest so installer-style macOS provisioning can happen without reshaping the data-plane command graph.
- The built CLI package shape exposes a `healthybob` bin alias that targets the same built entrypoint as `vault-cli`; `healthybob`, `healthybob --help`, and `healthybob setup ...` route to the setup surface, while other commands continue through the main operator surface. npm publish remains intentionally blocked until `@healthybob/cli` no longer depends on `workspace:*` packages.
- Repo-local macOS bootstrap is handled by `scripts/setup-macos.sh`, which now hard-fails off macOS and treats `--dry-run` (and the camel-case spelling accepted by the setup CLI) as a wrapper-only planning mode that does not install Homebrew/Node/pnpm, install dependencies, or build the workspace before the built setup entrypoint is available.
- The local web entrypoint lives under `packages/web`; `pnpm web:dev` starts the app in webpack mode through a wrapper that binds to `127.0.0.1`, blocks framework `.env*` reads, requires `HEALTHYBOB_VAULT` at runtime, verifies that the `@healthybob/query` package build output exists before Next starts, and renders only a read-only localhost surface with safe-field search over the query layer.
- Before adding a runtime target, document entrypoints, environment assumptions, and operational guardrails here.
