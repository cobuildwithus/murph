# Device Sync Dirty Sweeper Hard Cut

## Goal

Remove dirty state as a hosted runtime wake scheduler. Dirty rows should only
mean uncheckpointed device-sync work remains; they must not cause periodic
runtime recovery signals by themselves.

## Constraints

- Preserve webhook clean-to-dirty best-effort wake behavior.
- Preserve checkpoint-safe dirty acknowledgement after the hosted runtime
  durable workspace checkpoint.
- Preserve due-reconcile recovery for scheduled provider maintenance.
- Do not add leases, cooldown fields, schema changes, queues, or new workers.
- Keep Temporal pointer-only and Cloudflare as execution coordination only.
- Keep logs and docs metadata-only.

## Plan

1. Remove the dirty sweeper from the hosted device-sync recovery sweep.
2. Remove the dirty sweep response contract from web and Temporal.
3. Delete dead dirty-sweep code/tests and store scan methods that existed only
   for dirty recovery.
4. Keep runtime dirty drain and dirty ack paths unchanged.
5. Run focused recovery-sweep and dirty-store tests plus typecheck.

## Verification

- Focused web tests for recovery sweep and dirty connection store behavior.
- Focused Temporal activity/reconciler tests for the recovery sweep contract.
- `pnpm typecheck`
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
