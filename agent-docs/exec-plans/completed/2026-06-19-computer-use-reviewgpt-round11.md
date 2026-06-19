# Computer-Use ReviewGPT Round 11 Fix

## Goal

Resolve ReviewGPT round 10 findings on PR 214 with minimal, durable changes:

- block unsafe browser navigation targets before Kernel can fetch them
- ensure browserless provisioning rows delete deterministic Kernel browser names before terminal expiry
- let an awaiting final-confirmation/manual handoff mint a fresh link after the prior link is completed
- simplify handoff state where it clearly reduces code without broad churn

## Constraints

- Keep the computer-use API small and composable.
- Prefer existing recovery primitives over new lifecycle states.
- Do not rely on prompt-only safety for network or irreversible-action boundaries.
- Run focused tests, typecheck, full web verification, diff hygiene, and commit through `scripts/finish-task`.

## Working Set

- `packages/hosted-execution/src/computer-use.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/kernel-client.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/test/hosted-execution-computer-use.test.ts`
- `apps/web/test/hosted-retention-cleanup.test.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`

## Current State

- Starting from PR 214 commit `4ee95ffb`.
- Round 10 findings are accepted for the three high-risk bugs.
- Navigation now validates public hosts in the shared contract, verifies DNS in the app service before Kernel use, installs a public-network guard immediately after every Kernel browser creation, and routes Kernel navigation through that guard.
- IPv4-embedded/transition IPv6 literals are rejected conservatively.
- Browserless `cleanup_pending` expiry deletes the deterministic Kernel browser name before marking the row terminal, keeping deletion retryable on failure.
- Kernel browser deletion is named as id-or-name deletion to match the SDK contract.
- Completed manual/final-confirmation handoffs can be replaced while the run remains `awaiting_user`.
- Stale computer-run cleanup queries are bounded to avoid unbounded serial Kernel cleanup work.
- Handoff-table collapse is deferred. It would require schema, export/delete, claim, refresh, finish, and migration churn; the current one-authoritative-handoff pointer on `HostedComputerRun` is enough for this fix.

## Verification

- `pnpm --dir packages/hosted-execution test -- --runInBand` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-execution-computer-use.test.ts` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-retention-cleanup.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/hosted-execution test:coverage` passed.
- `pnpm --dir apps/web verify` passed; existing Turbopack trace warning only.
- `pnpm test:smoke` passed.
- `pnpm verify:acceptance` failed only on `packages/cli/test/incur-smoke.test.ts` timeout under full parallel load; the exact test passed standalone and `pnpm --dir packages/cli test:coverage` passed standalone.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
