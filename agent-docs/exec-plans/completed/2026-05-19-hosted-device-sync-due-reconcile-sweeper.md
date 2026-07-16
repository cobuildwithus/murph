# Hosted device-sync due reconcile sweeper

Status: completed
Created: 2026-05-19
Updated: 2026-05-19

## Goal

- Add an automatic hosted device-sync recovery path for active connections whose `next_reconcile_at` is due, even when no new provider webhook has made the dirty row pending.

## Success criteria

- Active due connections append an existing `device-sync.wake` with `scheduled-reconcile` semantics.
- Reauthorization-required and disconnected connections are not retried by this sweeper.
- Wake dedupe is stable within a bounded recovery bucket and does not introduce a new queue, lock, or state table.
- Existing dirty webhook recovery continues to behave unchanged.
- Dirty and due cron recovery both get attempted even if one sweeper fails.
- Focused tests and required verification pass, or any unrelated blocker is named precisely.

## Scope

- In scope:
  - Hosted web control-plane due-reconcile scan and cron recovery.
  - A small due-reconcile scan index for the cron query.
  - A dedicated reconcile-recovery runner nudge intent so duplicate due wakes can still wake the runner.
  - Tests for due active connections, skipped inactive statuses, and wake failures.
- Out of scope:
  - Browser “Sync now” / “Retry sync” button.
  - Manual production DB mutations.
  - Provider-specific WHOOP OAuth logic beyond exercising the existing scheduled reconcile path.

## Constraints

- Use existing `device-sync.wake` mailbox/workflow plumbing.
- Do not add new persisted state, broad locking, or provider-specific web logic.
- Keep logs metadata-only and fingerprint connection/user ids.
- Preserve unrelated dirty working-tree edits.

## Risks and mitigations

1. Risk: due-reconcile sweeper spams duplicate wakes every minute.
   Mitigation: use a stable dedupe key keyed by connection, `next_reconcile_at`, and a five-minute recovery bucket, relying on existing mailbox/event dedupe while still creating bounded fresh demand if the due row stays stale.
2. Risk: retrying unrecoverable revoked-token accounts forever.
   Mitigation: scan only `status = active`; the deployed WHOOP fix will move `invalid_grant` to `reauthorization_required` after the next retry.
3. Risk: extending dirty sweeper semantics until it becomes a mixed concern.
   Mitigation: keep due-reconcile selection separate and only share cron/orchestration and wake append primitives.

## Tasks

1. Add a store query for active due-reconcile connections.
2. Add a due-reconcile sweeper that appends scheduled-reconcile wakes with bounded concurrency and metadata-only logs.
3. Wire the existing device-sync cron to run both dirty and due-reconcile recovery.
4. Add focused tests for the new path and direct behavior.
5. Run verification, audits, commit, push, and deploy if green.

## Verification

- Commands to run:
  - `pnpm --dir apps/web test -- hosted-device-sync-due-reconcile-sweeper.test.ts`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - `pnpm typecheck`
- Direct proof:
  - Confirm production database/log evidence before the change showed due WHOOP active rows with no `reconcile_due` signals.
Completed: 2026-05-19
