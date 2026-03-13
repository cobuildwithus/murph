# Verification And Runtime

Last verified: 2026-03-12

## Verification Matrix

| Change scope | Required commands | Notes |
| --- | --- | --- |
| Docs/process-only | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Includes package-runtime checks, built CLI verification, and fixture/scenario scaffolding because those are part of repo truth now. |
| Fixture/e2e/package-doc changes | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Verifies fixture corpus integrity, smoke-manifest wiring, package-runtime health, built CLI checks, command-surface coverage, and the no-source-JS guard. |
| Changes under `packages/contracts`, `packages/core`, `packages/importers`, or `packages/query` | `pnpm typecheck`, `pnpm test:packages`, `pnpm test:smoke` | `pnpm test` remains required for full repo acceptance, but `pnpm test:packages` is the clean runtime signal when the doc-drift wrapper is blocked by an in-progress dirty worktree. `pnpm test:packages:coverage` is the matching Vitest/V8 signal when the change should hold the CLI-style per-file thresholds. |
| Changes under `packages/cli` | `pnpm typecheck`, `pnpm test`, `pnpm test:coverage` | Repo checks now run `packages/cli` typecheck plus package-local verification through `pnpm verify:cli`, and package tests build any required workspace dependencies before exercising the CLI. CLI runtime tests still execute through the built package path, so source coverage remains focused on the in-process `core`/`importers`/`query` runtime modules. |
| User explicitly says to skip checks | Skip checks for that turn only. | User instruction takes precedence. |

## Current Command Meaning

- `pnpm build`: executes the solution-style `tsc -b` build across the workspace package graph.
- `pnpm typecheck`: validates shell syntax, typechecks repo-owned TS tools, runs each package’s typecheck script, and verifies the shared `tsc -b` build.
- `pnpm test`: runs docs drift enforcement, package verification for `contracts`/`cli`/`core`/`importers`/`query`, and fixture/scenario integrity verification through `e2e/smoke/verify-fixtures.ts`.
- `pnpm test:packages`: runs executable runtime package checks plus the built CLI verification path, then executes the root Vitest suite with `--no-coverage`.
- `pnpm test:packages:coverage`: runs the same package-runtime path, then executes the root Vitest suite with deterministic single-file execution and V8 coverage using the sibling CLI thresholds (`perFile`, `lines/functions/statements=85`, `branches=80`) over the targeted `core`/`importers`/`query` source surface.
- `pnpm test:coverage`: runs doc-gardening validation, `pnpm test:packages:coverage`, verifies every documented baseline command has smoke coverage plus a golden-output scaffold, and fails if handwritten `.js`, `.mjs`, `.cjs`, or `.d.ts` source files remain under `packages/` or `e2e/`.
- `pnpm test:smoke`: runs only the fixture/scenario integrity verifier.

## Runtime Status

- No deployment target is defined yet.
- Repo-level checks execute canonical write/read paths in `core`, `importers`, and `query`, and they build the CLI package through the same TypeScript workspace toolchain used for local development.
- The built `vault-cli` binary can be exercised locally with `node packages/cli/dist/bin.js ...` when a change requires an end-to-end runtime check beyond the standard repo scripts.
- Before adding a runtime target, document entrypoints, environment assumptions, and operational guardrails here.
