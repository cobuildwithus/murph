# Land sparse webhook payload minimization patch across hosted onboarding

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Port the supplied webhook privacy patch onto the current worktree so hosted webhook persistence keeps only sparse snapshots needed for current delayed processing and clears payloads when they are no longer needed.

## Success criteria

- Device webhook traces stop persisting raw payload bodies.
- Hosted Stripe events persist only the minimal sparse snapshots current handlers still read and clear payloads when processing completes.
- Linq and Telegram hosted webhook receipts and dispatch references use sparse snapshots instead of raw payload bodies.
- The historical scrub migration lands without disturbing unrelated active work.
- Required repo verification passes, or any blocker is documented and shown to be unrelated.
- The task is closed through the repo's scoped commit workflow.

## Scope

- In scope:
  - `apps/web/src/lib/device-sync/prisma-store/webhook-traces.ts`
  - `apps/web/src/lib/hosted-onboarding/{stripe-event-queue.ts,webhook-event-snapshots.ts,webhook-provider-linq.ts,webhook-provider-telegram.ts,webhook-receipt-transitions.ts}`
  - `apps/web/prisma/migrations/2026040102_sparse_webhook_payload_minimization/migration.sql`
- Out of scope:
  - Historical `HostedWebhookReceipt` SQL rewrites beyond the supplied migration note.
  - Product or queue-behavior changes unrelated to payload minimization.
  - Dependency changes.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits and manually merge around current branch drift.
  - Respect current hosted onboarding and Stripe queue contracts.
- Product/process constraints:
  - Treat this as a high-risk persistence/privacy change and run the full required repo verification baseline.
  - Use scoped commit helpers rather than a hand-rolled commit flow.

## Risks and mitigations

1. Risk: Sparse snapshots may omit fields that delayed handlers still read.
   Mitigation: Trace the current snapshot readers before editing and keep only fields that existing handlers consume.
2. Risk: The patch overlaps an already-dirty hosted onboarding tree, especially `webhook-provider-linq.ts`.
   Mitigation: Read the current file state first, merge only the intended payload-minimization delta, and avoid reverting adjacent edits.
3. Risk: The data migration could over-scrub rows still needed by live processing.
   Mitigation: Keep the supplied migration limit that avoids blind `HostedWebhookReceipt` historical rewrites.

## Tasks

1. Register the task in the coordination ledger and inspect the supplied diff against current files.
2. Port the sparse-payload code changes onto the current `apps/web` state.
3. Add the historical payload-scrub migration.
4. Run required verification, fix any regressions, then finish with a scoped commit.

## Decisions

- This patch port is plan-bearing because it is a high-risk persistence/privacy change with Stripe and webhook state, and it overlaps already-dirty hosted onboarding files.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Outcomes:
  - `pnpm typecheck` passed.
  - `pnpm --dir apps/web test -- test/prisma-store-device-sync-signal.test.ts test/hosted-onboarding-webhook-receipt-transitions.test.ts test/hosted-onboarding-stripe-event-queue.test.ts` exercised the changed webhook/privacy paths successfully; unrelated pre-existing failures remained in `apps/web/test/page.test.ts`.
  - `pnpm test` failed for unrelated pre-existing workspace issues outside this patch, including `packages/cli/test/release-script-coverage-audit.test.ts` and existing hosted onboarding/cloudflare drift in other active lanes.
  - `pnpm test:coverage` failed for unrelated pre-existing workspace issues outside this patch, including the existing handwritten-source guard on `apps/web/eslint.config.mjs` and `packages/local-web/eslint.config.mjs`, plus existing hosted onboarding test/typecheck drift in other active lanes.
Completed: 2026-04-01
