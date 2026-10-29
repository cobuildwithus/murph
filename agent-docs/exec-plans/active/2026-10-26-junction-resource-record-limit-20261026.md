# Recover bounded Junction resource windows

Status: active
Created: 2026-10-26
Updated: 2026-10-29

## Outcome and invariant

New resource-only hourly-feature imports recover an oversized closed day through
complete, bounded hours. Keep collection caps, source admission, canonical writes,
foreground yielding and existing continuation/retry budgets. Daily aggregates
and oversized individual hours remain fail-closed. Historical terminal jobs are
not replayed, reset or otherwise mutated.

## Evidence and ownership

Full reconcile/backfill already reduces oversized hourly-feature days; the
resource-only closed-day batching owner did not. The real client/provider with
a synthetic 25,001-record day reproduces JUNCTION_API_RECORD_LIMIT before this
change. This lane owns PR4377; no competing resource recovery owner was found.

Round 1 accepted one serious finding: the resource manifest omitted the emitted
hourly scalar, so the real service rejected its durable continuation. The
composed service test reproduced DEVICE_SYNC_JOB_PAYLOAD_INVALID. The declaration,
complete-hour reader and retained scalar support now belong to the separately
merged reader PR4396. Its exact public source c74fd907fed1d7fc182f50eabaf08fe0342ec207
is deployed; Web, serving image, final promotion and warm-invocation convergence
are verified. Private operational receipts stay outside repository/review data.

## Minimal producer

Reuse the deployed reader. Extend the existing daily result and resource suffix
with the existing timeseriesWindowHours scalar, and share the existing full-job
overflow policy. There is no new reader helper, durable field, queue, cursor or state
owner in this producer. Keep the reader's required arguments rather than restore
redundant defaults. The production diff adds 15 lines and removes 3.

Previously committed days survive a later overflow. Each suffix owns at most one
complete UTC-hour collection and canonical import. Daily aggregate authority,
source revalidation, cancellation and collection limits do not expand. The
reader release is the rollback floor while hourly continuations can remain.

## Verification and Product UX

Effort: Patch. Outcome: newly executed dense resource history can advance through
complete hours. Reaches: existing admitted connected-source resource jobs.
Walkthrough: Ready. Synthetic proof covers 24 complete hours, an oversized hour,
unchanged daily aggregate failure, prior committed days, and real service enqueue,
SQLite reopen and hosted-hint restoration. Existing reader tests retain yield,
source-revocation and malformed-coordinate boundaries. Its temporary assertion
that unmarked overflowing days remain terminal is replaced by producer recovery
proof; duplicate reader-only cases are removed from the producer suite.

Current checks: 254 tests in nine focused device-sync files pass; package
typecheck passes; complexity debt falls 314 to 312 with maximum 95 unchanged.
Four production changelog rendering tests and documentation drift pass. Parent
candidate review found no further production mechanism or scope needed. Final
independent review, final-head CI, coordinated producer rollout and bounded
natural verification remain pending. No deployment claim repairs prior failed
work, which stays untouched.
