# Hosted Member Aggregate And Ledger Cleanup

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove stale hosted-onboarding/hosted-execution coordination drift from the active ledger.
- Simplify the hosted member aggregate read shape so it stops duplicating nested owner-table objects alongside the flat fields callers already use.

## Success criteria

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` no longer lists deleted member-private-state files or missing active-plan paths for the completed hosted send-code and hosted-execution seam work.
- `readHostedMemberAggregate()` returns one flat aggregate shape without duplicate `identity`, `routing`, or `billingRef` nested objects.
- Focused hosted member store coverage reflects the simplified aggregate shape.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`
- `apps/web/test/hosted-onboarding-member-store.test.ts`

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- `pnpm exec vitest run apps/web/test/hosted-onboarding-member-store.test.ts --config apps/web/vitest.workspace.ts --no-coverage`

## Results

- Passed: focused hosted member store Vitest coverage for the simplified aggregate shape.
- Passed: `pnpm --dir apps/web lint` with pre-existing warnings only.
- Failed for unrelated pre-existing reasons: `pnpm typecheck`
  - existing failures in `packages/core`, `packages/assistant-engine`, `packages/cli`, and `packages/setup-cli`
- Failed for unrelated pre-existing reasons: `pnpm test:coverage`
  - same existing non-hosted-member failures before this narrow lane could reach full acceptance
Completed: 2026-04-07
