# Reconcile inherited database monitor counts from existing samples

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and evidence

The old writer can count a completed scheduled slot twice while upserting one
sample. Preventing new replays does not repair that inherited discrepancy.
Reconcile below-threshold counts from the bounded contiguous failed-sample
suffix before collection, and persist the correction with the next sample.
Keep counts at or above six unchanged to preserve acknowledged one-shot state.

## Scope and proof

Reuse the existing latest-sample read, counter, admission transaction and delivery
owner. No schema, queue, additional provider call or new state owner. Preserve
first-pressure admission, pending bodies/keys and hourly delivery pacing.
Produce synthetic inherited state by executing the actual pre-PR monitor/store,
upgrade that same SQLite storage, and continue only distinct slots across restart.
Retain the generated synthetic fixture for repeatable CI proof without Git-history
or network dependencies. Check the successful-sample boundary, six distinct
failed samples, pressure delivery, and one-shot behavior after acknowledgment.
Member conversation behavior is unchanged. Operator outcome: Ready when focused
proof and parent review pass; deployment remains separate.

## Tasks

1. Run old-writer/new-reader proof and capture synthetic state.
2. Reconcile the bounded pre-threshold count; add durable regression coverage.
3. Verify focused tests, typecheck, complexity and docs; review and commit.
4. Run authorized review round four concurrently with exact-head CI.

## Review authorization and deployment

The user explicitly resumed after the three-round cap and authorized the bounded
repair plus a fourth review. Preserve earlier reviewed heads and dispositions.
The persisted shape remains unchanged; Worker-only rollout, no migration or
Web/container ordering requirement. Reversal restores prior policy; no production
mutation or rollout is part of this task. Local verification is complete; PR gates remain pending.

## Verification and parent review

The actual pre-PR monitor and store at `b5bfd8c6c7a5` produced the replay drift
using synthetic provider responses. Reopening the same SQLite storage with the
previous candidate reproduced a threshold exception without older failure rows,
and premature threshold admission when older recovered failures were present.
Both old-to-new replays pass after the correction. The captured synthetic fixture
retains the successful-sample boundary and the acknowledged old two-check page.

All 143 focused monitor/metrics/store/Worker-routing tests, 6 real workerd Durable
Object tests, Cloudflare typecheck, complexity guard, and diff whitespace checks
pass. The two additional direct upgrade replays pass. Regression tests verify
six distinct failures, pressure delivery after the fence opens, restart survival,
and no new page for an already-acknowledged six-check gap.

Parent review confirms at most five recent sample rows for replay detection and
pre-threshold reconciliation, no new persisted state or provider work, and
transactional persistence with the next sample. The two failure branches share
one explicit pre-collection count; complexity debt remains unchanged. Product UX:
Ready for final review. No public changelog: internal operator monitoring only.
The authorized fourth review and final-head CI have not yet completed.
Completed: 2026-09-12
