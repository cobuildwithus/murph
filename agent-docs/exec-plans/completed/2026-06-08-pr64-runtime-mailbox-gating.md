# PR64 Runtime Mailbox Gating

## Goal

Implement the PR64 hosted-runtime shape:

- Fresh `mailbox_appended` signals on any lane direct-process through Temporal.
- Manual runtime-control requests gate hosted AI usage before appending `runtime.manual-requested`.
- Legacy and carried-pointer demand reads remain intact.
- Existing Temporal histories and old manual producers stay on the old demand-read path.

## Constraints

- Keep Temporal state pointer-only.
- Do not move mailbox payloads, usage decisions, or product policy into Temporal.
- Keep web as owner of AI usage/product policy and mailbox facts.
- Preserve old demand-read fallback for carried pointers and old direct-demand flags.
- Non-conversation direct processing needs its own Temporal patch marker.
- Old manual signal source `manual` must keep using demand read; freshly gated manual producers use `manual-ai-gated`.

## Scope

- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-usage-decision.ts`
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`
- `apps/web/src/lib/hosted-orchestration/manual-wake.ts`
- Focused web and Temporal tests for the changed behavior.
- Active plan and coordination ledger, closed by `scripts/finish-task`.

## Verification

Run results:

- PASS `pnpm --filter @murphai/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow.test.ts`
- PASS `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-orchestration-manual-wake.test.ts`
- PASS `pnpm --filter @murphai/hosted-orchestrator-temporal typecheck`
- PASS `pnpm --dir apps/web typecheck`
- PASS `pnpm test:diff packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts apps/web/src/lib/hosted-orchestration/runtime-usage-decision.ts apps/web/src/lib/hosted-orchestration/signal-runtime.ts apps/web/src/lib/hosted-orchestration/manual-wake.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-orchestration-manual-wake.test.ts`
- PASS `pnpm test:smoke`
- PASS `pnpm --dir apps/web lint`
- FAIL `pnpm typecheck`: unrelated `packages/query` failure resolving `@murphai/importers/sample-series-summary` plus implicit-any in `packages/query/test/query.test.ts`.

Required completion audit passes ran. Security/privacy had no blocking finding.
Coverage-write added resolver Prisma-forwarding proof. Deep/final review found
Temporal replay and old-manual-producer deploy-skew risks; both were fixed with
a new any-lane patch marker plus `manual-ai-gated` source.

## State

- Status: Ready to close
- Branch: `codex/pr64-runtime-mailbox-gating`
- Notes: Draft PR opened as #64 during audits; final commit should close this plan.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
