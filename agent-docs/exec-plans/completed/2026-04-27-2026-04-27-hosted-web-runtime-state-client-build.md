# Fix hosted web Turbopack client build importing runtime-state Node modules

Status: completed
Created: 2026-04-27
Updated: 2026-04-27

## Goal

- Fix the hosted web production build failure where Turbopack tries to emit `@murphai/runtime-state` Node-only modules into an app-client chunk.

## Success criteria

- `apps/web` production build no longer fails on runtime-state Node module chunk generation.
- The fix preserves the intended server/client boundary instead of weakening runtime-state or reintroducing custom Turbopack loader rewriting.
- Focused tests or direct build proof cover the boundary.

## Scope

- In scope:
- Hosted web imports, runtime-state public entrypoint usage, and directly coupled tests/config needed to keep Node-only modules out of client chunks.
- Out of scope:
- Broader hosted-runtime migration work, Cloudflare Durable Object changes, dependency upgrades, and unrelated dirty hosted-web UI edits.

## Constraints

- Technical constraints:
- Preserve package-boundary rules: import workspace packages by package name through declared public entrypoints only.
- Do not add dependency changes.
- Do not weaken runtime-state Node-only file behavior for browser use.
- Product/process constraints:
- Preserve unrelated active ledger rows and dirty files.
- Follow hosted-web verification guidance from `agent-docs/operations/verification-and-runtime.md`.

## Risks and mitigations

1. Risk: A broad alias or fallback masks a real server-only import leak.
   Mitigation: Trace the actual import chain and patch the smallest boundary that causes app-client bundling.
2. Risk: Verification is noisy because the tree has unrelated dirty work.
   Mitigation: Use scoped commands against the touched paths when needed and report any unrelated red checks precisely.

## Tasks

1. Reproduce the hosted web build error locally and capture the concrete Turbopack cause.
2. Trace the app-client import path from `apps/web` into runtime-state Node-only modules.
3. Patch the smallest server/client boundary and add focused coverage if the repo has an existing test seam.
4. Run required checks and completion audits.
5. Close the plan and create a scoped commit if no overlapping dirty work blocks it.

## Decisions

- Added `@murphai/hosted-execution/browser-vault` as a narrow public subpath for browser-vault replica refs instead of importing the broad hosted-execution parser barrel from client code.
- Left the existing broad `@murphai/hosted-execution/parsers` barrel intact for server/internal callers.

## Verification

- Commands to run:
- `pnpm --dir apps/web build` or the narrower repo-owned equivalent that reproduces the Vercel failure.
- `pnpm typecheck`.
- `bash scripts/workspace-verify.sh test:diff <touched paths>` or owner-level hosted-web verification depending on touched files.
- Expected outcomes: build and typecheck pass; any scoped test lane failures are unrelated and documented with exact failing targets.

Completed:
- `pnpm --dir apps/web exec next build` with deterministic placeholder hosted-web build env: passed; the reported app-client Turbopack runtime-state chunk failure is gone. Existing Turbopack NFT warning remains.
- `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false`: passed.
- `pnpm --dir apps/web lint`: passed with warnings only.
- `pnpm exec vitest run apps/web/test/browser-vault-session-route.test.ts --config apps/web/vitest.config.ts --no-coverage`: passed.
- `pnpm --dir packages/hosted-execution build`: passed.
- `pnpm --dir packages/hosted-execution test -- hosted-execution.test.ts`: passed.
- `pnpm exec vitest run scripts/workspace-source-resolution.test.ts --config scripts/vitest.config.ts --no-coverage`: passed.
- `git diff --check -- <touched paths>`: passed.

Known unrelated blockers:
- `pnpm typecheck` fails in `apps/web` before TypeScript because `health-commons:generate` reports `Unexpected array indentation` in unrelated untracked alcohol-abstinence Health Commons content.
- Scoped `test:diff` reaches reverse-dependent CLI tests and fails on unrelated supplement/document/intervention/workout command-surface expectations.
- `pnpm --dir packages/hosted-execution test:coverage` runs all hosted-execution tests successfully but fails existing broad coverage thresholds for the legacy parser barrel.
Completed: 2026-04-27
