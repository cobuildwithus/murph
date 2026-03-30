# 2026-03-30 Security Audit Patch Landing

## Goal

- Land the supplied security audit follow-up cleanly against the current worktree.
- Preserve existing behavior except for the intended hardening:
  - atomic file replacement/create paths in `packages/core`
  - safer backup/rollback copy semantics in write batches
  - stricter `returnTo` validation in device-sync daemon and web helpers

## Scope

- `agent-docs/exec-plans/active/2026-03-30-security-audit-patch-landing.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/core/src/{atomic-write.ts,fs.ts,operations/write-batch.ts}`
- `packages/core/test/core.test.ts`
- `packages/device-syncd/src/shared.ts`
- `packages/device-syncd/test/public-ingress.test.ts`
- `packages/web/src/lib/device-sync.ts`
- `packages/web/test/device-sync-lib.test.ts`
- `vitest.config.ts`

## Findings

- The supplied patch introduces a new atomic-write helper module instead of inlining more filesystem edge-case handling into existing call sites.
- The current tree still performs direct overwrite/copy operations in `packages/core` that can leave partially replaced files or overwrite rollback targets less defensively than intended by the audit.
- The current device-sync `returnTo` handling accepts any leading-slash value, which leaves protocol-relative, backslash-prefixed, and credential-bearing URL shapes insufficiently constrained.
- The repo currently has overlapping active lanes and unrelated dirty files, so this landing must preserve adjacent edits and stay narrowly scoped.
- The curated root Vitest include list was not running `packages/device-syncd/test/public-ingress.test.ts`, so the new regression file needed an explicit manifest update and exposed one stale host assertion in that suite.
- Required audit delegation was attempted first via the built-in spawn hook and then via the local `codex-workers` fallback, but this environment did not return usable terminal audit artifacts from either path.

## Constraints

- Treat the supplied patch as intent, not an authority to overwrite live files blindly.
- Preserve existing public interfaces and nearby in-flight work.
- Keep the change proportional: no speculative refactors outside the audited filesystem and `returnTo` paths.
- Run the repo’s mandatory audit subagent passes before handoff because this is repo code, not a docs-only change.

## Plan

1. Register the active lane in the coordination ledger and finish reading the live file state for every touched surface.
2. Add the atomic-write helper module and switch the affected core write paths to use it.
3. Tighten device-sync and web `returnTo` validation, then add focused regression tests for the new edge cases.
4. Run focused tests for touched packages, then run the required repo commands and record any unrelated blockers if they remain.
5. Run the mandatory `simplify` and `task-finish-review` audit passes, apply any valid findings, then close the plan and commit the touched files.

## Verification

- Passed:
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/core test`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm exec vitest run packages/device-syncd/test/public-ingress.test.ts --no-coverage`
  - `pnpm --dir packages/web typecheck`
  - `pnpm exec vitest run --config packages/web/vitest.config.ts packages/web/test/device-sync-lib.test.ts --no-coverage`
- Failed outside this patch scope:
  - `pnpm typecheck`
    - `packages/core/src/history/api.ts`: `revision` typed as `unknown` via the hosted web typecheck path
  - `pnpm test`
    - `packages/query/src/canonical-entities.ts`: pre-existing query build/type failures during the shared workspace build
  - `pnpm test:coverage`
    - `packages/query/src/canonical-entities.ts`: the same pre-existing query build/type failures during the shared workspace build
- Audit delegation attempts:
  - Built-in spawned-audit attempt did not return a usable result to the parent context.
  - Local `codex-workers` fallback for `simplify` and `task-finish-review` each reached substantive review output in their logs but did not emit terminal result artifacts (`*.last.txt` / `*.exit`), so the required audit passes remain tooling-blocked in this environment.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
