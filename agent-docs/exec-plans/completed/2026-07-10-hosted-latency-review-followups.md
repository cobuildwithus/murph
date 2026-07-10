# Hosted latency review follow-ups (post-PR #519)

## Goal

Fix the four material gaps a deep review found in merged PR #519 ("Reduce
hosted reply hot-path latency") without adding schedulers, managers, or new
lifecycle machinery:

1. Attempt telemetry could delay Codex start and discard a successful reply:
   `recordCodexAttemptStarted` was awaited before the provider ran and
   `recordCodexAttemptSucceeded` was awaited inside the success try block, so
   a failed receipt write reclassified a successful turn as a provider
   failure. Both events were write-only (no reader anywhere).
2. An optional diagnostics write in `finalizeAssistantTurnFromDeliveryOutcome`
   ran after authoritative receipt finalization but before first-contact
   state; its failure entered notification commit-error handling and marked
   an already-pending queued outbox intent abandoned.
3. PR #519 removed the maintenance owner from `sendAssistantMessageLocal`, so
   direct ask/chat/assistantd modes could grow runtime state (transcripts,
   event logs) without bound; the regression test covering this was deleted.
4. The automation pass checked foreground availability once, then ran the
   whole maintenance pass under the runtime write lock with no way to yield
   when a foreground wake arrived mid-pass.

## Approach

- Delete the write-only start/success attempt events (keep
  `recordCodexAttemptFailed`, which feeds diagnostics). Keep the contract enum
  values so persisted receipts still parse.
- Make the terminal delivery diagnostic last and best-effort; receipt
  finalization stays the commit, first-contact marking stays awaited.
- Restore a post-turn maintenance owner in `sendAssistantMessageLocal` for
  `turnTrigger !== 'automation-auto-reply'` (try/finally around the locked
  turn), keeping maintenance off the foreground reply path.
- Thread the existing `shouldYieldBackgroundMaintenance` predicate and abort
  signal into `maybeRunAssistantRuntimeMaintenance`; check between bounded
  units, note a yielded pass, and preserve the previous `lastRunAt` so the
  next idle pass retries promptly.

## Verification

- Full `assistant-engine` (2017), `assistant-runtime` (1497), and
  `assistant-cli` (128) suites pass; workspace build and typecheck pass.
- New regression tests: diagnostic-rejection on model and exact-text
  queue-only notifications (bite-checked against the reverted fix), post-turn
  maintenance ownership and ordering, restored oversized-event-log compaction
  in direct mode, mid-pass yield and aborted-signal skip, run-loop threading
  of the yield predicate.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
