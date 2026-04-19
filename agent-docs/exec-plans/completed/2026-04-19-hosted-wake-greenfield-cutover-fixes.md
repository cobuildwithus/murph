## Title

Verify and fix the remaining greenfield hosted-wake cutover blockers before final hard-cut.

## Goal

Confirm which reported hosted-wake issues are real in the current tree, then land only the fixes still needed for greenfield bootstrap truth, cursor advancement/finalization correctness, and stale pending-commit recovery across coalesced wake identity rewrites or crash-before-terminal resume.

## Scope

- `apps/web/prisma/migrations/2026040600_init/migration.sql`
- `apps/web/src/lib/hosted-wake/store.ts`
- `apps/web/test/{hosted-wake-store.test.ts,hosted-onboarding-member-store.test.ts,hosted-onboarding-privacy-foundation-migration.test.ts}`
- `apps/cloudflare/src/user-runner.{ts}`
- `apps/cloudflare/src/user-runner/{runner-state-store.ts,runner-wake-processor.ts,types.ts}`
- `apps/cloudflare/test/{runner-state-store.test.ts,user-runner-hosted-wake.test.ts,user-runner.test.ts,workers/worker-entry.ts}`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Treat this as greenfield bootstrap work: the checked-in init migration must match the current Prisma schema from an empty database.
- Keep web/Postgres as the canonical owner of hosted wake ordering, cursor progression, and assistant schedule projection.
- Do not weaken the existing fetched-proof, terminal-receipt, or finalize-token fences.
- Clear stale pending commits only when canonical web status proves the old event identity or fetch fence is no longer current for that wake.
- Preserve unrelated dirty-tree edits outside this exact hosted-wake cutover lane.

## Verification

- Passed: `pnpm --dir apps/web exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` matched the checked-in bootstrap migration after normalization.
- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-wake-store.test.ts test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage`
- Passed: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-state-store.test.ts test/user-runner-hosted-wake.test.ts test/user-runner.test.ts --no-coverage`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `pnpm --dir apps/web verify`
- Known unrelated failure: `pnpm --dir apps/cloudflare typecheck`
- Known unrelated failure: `pnpm --dir apps/cloudflare verify`
- Passed: required `coverage-write` audit found no additional proof gaps.
- Passed after reruns: required `task-finish-review` audit found and then cleared stale wake-hint and stale alarm cleanup gaps; the final rerun reported no findings.

## Notes

- The requested review listed schema drift, no-op cursor advancement, schedule-only finalize, and pending-commit/coalescing races; implementation should cover only the blockers that still reproduce in the current tree.
- Because this is a greenfield cutover, bootstrap migration truth matters more than compatibility migration layering.
- The Cloudflare stale-pending cleanup now also clears DO-local `nextWakeAt` / wake-materialization hints and the actual Durable Object alarm so `status()` and retry scheduling do not keep stale schedule data after a discarded commit.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
