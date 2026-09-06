# Persist Telegram file dispatch before provider entry

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal and authority

Correct the accepted recovery finding on PR #2875 under the requested PR/ReviewGPT completion work. Prevent duplicate private Telegram file uploads after a runner crash restores an earlier retryable snapshot.

## Review disposition

Round 1 on `654da071262c4703a9602656e940d1fc16f336f9`: one accepted high-severity finding. The vault-file exclusion prevents a prepared sending claim; ordinary retry dispatch can precede snapshot publication. Approval consumption is idempotent for the stable consumer, so it cannot suppress an upload whose receipt was lost. The model and exact response hash were verified; the capture ran over thirteen minutes.

## Implementation

Admit Telegram vault files to the existing prepared-dispatch owner. Route their ordinary and foreground delivery through the same durable-checkpoint callback already used for non-idempotent system-mailbox delivery. Preserve Linq behavior and approval identities. Add no persistence, queues, or approval owners.

## Verification

Use real outbox, approved bytes, hosted phase dispatch, and checkpoint/restore composition to prove an accepted upload is not repeated after lost receipt state. Cover normal approved delivery and definitive-rejection retry. Run the affected phase/callback regressions, runtime typecheck, complexity guard, and exact-head CI; then review the pushed correction in round 2 with the immutable first head.

## Local result

- Before/after proof: the retry regression fails on the exact first-reviewed production source with 10 provider calls instead of 9 before the durable boundary. Restoring the correction makes both approval and retry crash/restore scenarios pass.
- Both final scenarios verify zero provider entry before snapshot publication, one accepted upload, no immediate replay after receipt loss, and eventual terminal `ASSISTANT_DELIVERY_AMBIGUOUS` recovery. Three real definitive rejections reach the existing 30/120/600-second outbox backoffs and remain retryable.
- Existing Linq outbox, delivery-phase, and foreground-phase suites: 188 passed.
- Runtime typecheck passed on the final source. Complexity guard passed across 12 changed source files; all 44 existing hotspots retain or reduce debt.
- Parent inspection confirms the same durable callback covers approval wake and ordinary retry dispatch. No new state owner or data schema is introduced. A file batch can wait for the configured idle checkpoint before upload; the PR records that latency tradeoff.
- The scoped correction is locally complete. The subsequent full-snapshot round 2 and exact-head CI remain PR completion gates; this completed plan is historical implementation evidence, not a claim of final review approval.
Completed: 2026-09-04
