# PR 295 ReviewGPT Round 1

## Goal

Resolve accepted ReviewGPT round-1 findings on PR 295 with the smallest durable
changes:

- Retell `call_analyzed` must not mark a call analyzed without durably enqueueing
  the final user notification.
- Retell webhooks must recover calls by Murph call metadata if the post-start
  `providerCallId` write failed.
- Live `ask_murph` fallback must not request transfer when the brief disallows it
  or no verified transfer destination exists.

## Constraints

- Preserve the hosted runtime side-effect primitive: assistant tool -> hosted
  runtime port -> web-owned Retell runtime.
- Do not add task/attempt tables, broad reconciliation loops, provider event
  tables, or a second phone supervisor.
- Do not persist raw Retell transcripts, webhook bodies, function bodies,
  recordings, or audio.
- ReviewGPT artifacts under `audit-packages/` remain local and uncommitted.

## Key Decisions

- Accept all three round-1 findings as real after code inspection.
- Use Retell `metadata.murph_phone_call_id` as the stable recovery identity for
  lifecycle webhooks, while keeping `providerCallId` unique as the provider id.
- Preserve retry safety by committing result update and mailbox append in one DB
  transaction instead of adding a new notification marker.

## Plan

1. Add focused regression coverage for metadata-based webhook recovery,
   transactional notification retry safety, and transfer fail-closed consultation.
2. Patch phone-call result handling and consultation with minimal owner-local
   changes.
3. Run focused verification, commit with `scripts/finish-task`, push, and rerun
   ReviewGPT on the pushed PR head.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts --no-coverage`
- Passed: `pnpm --filter @murphai/hosted-web typecheck`
- Passed: `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
