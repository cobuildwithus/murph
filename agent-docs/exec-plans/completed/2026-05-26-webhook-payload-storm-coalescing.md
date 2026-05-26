# Webhook Payload Storm Coalescing Plan

## Goal

Fix hosted device-sync webhook storm handling at the correct boundary: coalesce rehydratable dirty hints while preserving durable webhook work.

Success criteria:

- Rehydratable hint bursts do not do linear dirty-row writes, signal inserts, trace completions, or mailbox appends once the connection is already dirty.
- Durable webhook work is never accepted and dropped; it is durably persisted or returned retryable without completing the claimed trace.
- Concurrent webhook acceptance is bounded by a connection-scoped non-blocking lock and avoids sleeping inside hot ingress transactions.
- Focused regressions cover hint coalescing, payload safety, and lock-loser behavior.

## Constraints

- Preserve unrelated dirty worktree edits and active coordination-ledger rows.
- Do not expose raw webhook payloads, account IDs, local paths, headers, secrets, or health values in logs, docs, tests, or final output.
- Prefer existing public-ingress, dirty-connection, trace, and mailbox primitives over adding a payload table unless tests prove it is needed now.
- Keep the architecture simple: dirty flags are level-triggered, durable webhook work is event/job-triggered.

## Plan

1. Inspect current public-ingress, hosted wake, dirty-store, trace, and Junction payload behavior.
2. Add a provider/job-level classifier for coalescible hint webhooks versus durable webhook work.
3. Add a hosted pre-claim fast path only for coalescible hints that are already dirty.
4. Add a connection-scoped acceptance lock around the first dirty transition; lock losers must preserve payload safety.
5. Update focused tests and run the required verification/audit workflow.

## Notes

- Junction daily data webhook jobs can carry `webhookDataJson` and the runtime can import those direct records before REST fallback, so they must not use a generic already-dirty accept/drop path.
- The existing burst test proves the current bug: runner wake coalescing exists, but ingress still performs one dirty write, signal insert, and trace completion per webhook.
- Fresh Garmin repro showed a second runtime issue after ingress coalescing: explicit `device-sync.reconcile` wakes projected into an already-running foreground invocation were skipped because device sync only ran for alarm requests, then later assistant progress could clear the pending device-sync wake.
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
