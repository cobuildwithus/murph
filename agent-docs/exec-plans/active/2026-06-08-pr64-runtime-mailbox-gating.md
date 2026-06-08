# PR64 Runtime Mailbox Gating

## Goal

Implement the PR64 hosted-runtime shape:

- Fresh `mailbox_appended` signals on any lane direct-process through Temporal.
- Manual runtime-control requests gate hosted AI usage before appending `runtime.manual-requested`.
- Legacy and carried-pointer demand reads remain intact.

## Constraints

- Keep Temporal state pointer-only.
- Do not move mailbox payloads, usage decisions, or product policy into Temporal.
- Keep web as owner of AI usage/product policy and mailbox facts.
- Preserve old demand-read fallback for carried pointers and old direct-demand flags.

## Scope

- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-usage-decision.ts`
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`
- `apps/web/src/lib/hosted-orchestration/manual-wake.ts`
- Focused web and Temporal tests for the changed behavior.

## Verification

Run:

- `pnpm --filter @murphai/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow.test.ts`
- `pnpm --dir apps/web test -- hosted-orchestration-signal-runtime.test.ts hosted-orchestration-manual-wake.test.ts`
- `pnpm typecheck`

Also run the required completion audit passes for a high-risk hosted runtime change.

## State

- Status: Active
- Branch: `codex/pr64-runtime-mailbox-gating`
- Notes: New worktree based on `origin/main`; keep the PR diff scoped to this plan.
