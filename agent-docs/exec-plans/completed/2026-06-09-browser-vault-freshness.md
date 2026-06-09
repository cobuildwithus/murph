# Browser vault freshness source-hash fix

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Stop browser-vault replicas from being classified stale only because their
  `generatedAt` is milliseconds before the workspace checkpoint that publishes
  them, and stop the dashboard from showing an indefinite active-sync toast
  after the short stale-poll window ends.

## Success criteria

- Browser-vault freshness no longer uses workspace `checkpointedAt` as a
  content-version signal.
- Existing source-hash, max-age, missing, and invalid timestamp freshness
  behavior remains covered by tests.
- The browser-vault provider does not leave a permanent "Syncing latest
  changes..." indicator when the backend still reports refresh pending.
- Focused tests and required repo verification/review steps pass or have a
  documented unrelated blocker.

## Scope

- In scope:
  - `packages/hosted-execution/src/browser-vault.ts`
  - `packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts`
  - `apps/web/src/lib/browser-vault/session-handler.ts`
  - `apps/web/src/lib/browser-vault/context.tsx`
  - dashboard empty-state copy for pending initial replica refreshes
  - focused browser-vault tests
  - durable architecture/protocol wording for browser-vault freshness ownership
- Out of scope:
  - adding a new scheduler, sweeper, or persisted state
  - changing Cloudflare/Temporal runtime ownership
  - changing device-sync import semantics

## Constraints

- Technical constraints:
  - keep browser-vault refresh as normal hosted runtime work
  - preserve foreground hosted runtime priority
  - keep Cloudflare as a thin execution runner
- Product/process constraints:
  - prefer deletion/simplification over tolerances, extra state, or new queues
  - preserve unrelated active worktree and ledger edits

## Risks and mitigations

1. Risk: removing the checkpoint timestamp check hides a stale content replica.
   Mitigation: keep source hash and max-age checks as the freshness authority;
   runtime already computes the canonical query-source hash when it can prove
   current source.
2. Risk: hiding the sticky indicator removes useful feedback while a refresh is
   genuinely pending.
   Mitigation: keep background polling and refresh state available to consumers,
   but avoid presenting stale backend hints as active sync.

## Tasks

1. Remove checkpoint-based browser-vault freshness classification.
2. Update web session route to stop passing checkpoint time into freshness.
3. Simplify or remove the global sync indicator so it cannot stick forever.
4. Update focused tests for the freshness contract and UI behavior.
5. Run focused verification, required audits, and final scoped commit.

## Decisions

- Use source hash/max age as freshness truth; do not add a timestamp tolerance
  or new refresh scheduler.

## Verification

- Commands to run:
  - `pnpm test:diff packages/hosted-execution/src/browser-vault.ts packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts apps/web/src/lib/browser-vault/session-handler.ts apps/web/src/lib/browser-vault/context.tsx apps/web/test/browser-vault-session-route.test.ts apps/web/test/browser-vault-context.test.tsx packages/hosted-execution/test/hosted-execution.test.ts`
  - `pnpm --dir apps/web test -- browser-vault-session-route.test.ts browser-vault-context.test.tsx`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/browser-vault-session-route.test.ts apps/web/test/browser-vault-context.test.tsx apps/web/test/browser-vault-dashboard-pages.test.tsx`
  - `pnpm --dir packages/hosted-execution test -- hosted-execution.test.ts`
  - additional focused tests if `test:diff` does not cover the edited surface
- Expected outcomes:
  - focused tests pass
  - type-level checks from the diff-aware lane pass
Completed: 2026-06-09
