# 2026-03-31 CLI Assistant-Core Facades

## Goal

- Reduce confused ownership between `packages/cli` and `packages/assistant-core` by making CLI headless runtime/state modules thin facades over the dedicated `@murph/assistant-core` owner package while preserving CLI command, Ink/UI, and daemon-client behavior.

## Scope

- `agent-docs/exec-plans/active/2026-03-31-cli-assistant-core-facades.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/assistant-core/package.json`
- `packages/assistant-core/README.md`
- `packages/cli/{package.json,README.md,tsconfig.json,tsconfig.typecheck.json,scripts/verify-package-shape.ts}`
- Selected `packages/cli/src/**` headless runtime/state facades and assistant daemon-aware wrappers
- Focused CLI boundary tests
- `ARCHITECTURE.md`

## Findings

- `packages/assistant-core/src` currently mirrors a large portion of `packages/cli/src`; in this archive there are 171 overlapping source files, including 163 byte-identical duplicates.
- The main behavioral differences are the expected CLI-only daemon-aware wrappers (`assistant/service`, `assistant/store`, `assistant/status`, `assistant/outbox`, `assistant/cron`, and `assistant/automation/run-loop`) plus a small drift in `vault-cli-errors.ts`.
- The existing Vitest workspace alias helper already supports package subpaths, so assistant-core can own module-shaped entrypoints without adding bespoke test-only alias rules.
- In the live repo, `NodeNext` local source builds also needed `tsconfig.base.json` to map `@murph/assistant-core/*` to `packages/assistant-core/src/*.ts`; package exports alone were not enough for workspace typecheck/build.
- The archive patch's retained daemon-aware wrappers did not match the current assistant-core local API exactly, so the live landing had to preserve older CLI wrapper signatures while delegating to assistant-core implementations underneath.

## Constraints

- Preserve CLI command/UI entrypoints and the daemon-aware wrapper semantics.
- Do not make `@murph/assistant-core` depend on `murph`.
- Avoid changing provider routing, canonical write ordering, or gateway semantics.
- Preserve the existing `assistantd` build references already present in the live tree.
- Preserve unrelated dirty-tree edits and active Responses/provider-routing work.

## Plan

1. Publish assistant-core subpath exports and wire CLI to depend on assistant-core explicitly.
2. Convert selected duplicated CLI headless/runtime/state modules into assistant-core facades.
3. Keep daemon-aware CLI wrappers in place, but have them call assistant-core local implementations instead of owning duplicate logic.
4. Add focused package-shape/boundary checks, workspace source-resolution support, and update durable architecture/package docs.
5. Run repo-required checks, then fall back to scoped seam verification when repo-wide red lanes are confirmed unrelated.

## Verification

- Passed: `pnpm --dir packages/assistant-core typecheck`
- Passed: `pnpm --dir packages/cli typecheck`
- Passed: `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts`
- Passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-core-facades.test.ts --no-coverage`
- Passed: `node scripts/build-test-runtime-prepared.mjs`
- Passed after seam fixes: `pnpm typecheck`
- Failed before seam-specific fixes: `pnpm test:coverage`
  - Initially exposed missing local source resolution for `@murph/assistant-core/*` and wrapper API drift, both now fixed.
- Still red for unrelated active work: `pnpm test`
  - Existing failures remain in broader CLI suites and other active lanes outside this ownership seam.
- Simplify audit: addressed two findings by sourcing retained wrapper types directly from assistant-core and extending prepared-runtime smoke imports to the assistant-core subpaths actually referenced by CLI source.
- Final review audit: no actionable findings.

## Outcome

- Ready to close and commit with focused seam proof green. Residual repo-wide risk remains in unrelated red `pnpm test` lanes and the lack of a manual daemon-present versus daemon-absent operator flow check.

Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
