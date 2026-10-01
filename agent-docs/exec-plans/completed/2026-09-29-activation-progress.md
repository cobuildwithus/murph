# Honor foreground checkpoint deferral in activation progress alerts

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Goal

Prevent activation progress alerts during a proven foreground checkpoint window,
while retaining alerts for actual overdue or unproven work.

## Scope and protected invariants

Web monitoring only. Reuse runtime-owned checkpoint deadlines, exact current
attempt/generation, and terminal foreground evidence. Do not change runtime
scheduling, foreground priority, mailbox consumption, or production state.
No new persisted state, dependency, or deployment protocol.

## Evidence and decision

The runtime intentionally defers activation to foreground activity and its idle
checkpoint. The monitor already honors exact conversation checkpoint evidence,
but system activation lacks that classification. Use one indexed latest-trace
lookup per activation candidate, bound to its active runtime owner and imported
workspace generation. Missing, stale, or contradictory evidence fails closed.
Production evidence remains private; fixtures are synthetic.

## Product UX

Internal operational correction. Member replies and activation execution retain
their existing timing and authority. Operators receive overdue activation alerts
once the bounded checkpoint expectation expires, using the original work age.

## Tasks

1. Add narrow current-owner activation checkpoint evidence to the monitor.
2. Prove deadline expiry and rejection of unrelated/stale/unimported evidence.
3. Run focused unit/PostgreSQL tests, Web typecheck, complexity guard, and review.
4. Commit the scoped change; report deployment separately.

## Verification

- Both monitor test files pass: 33 tests against an isolated current-schema local
  PostgreSQL database. The pre-existing shared test database was outdated; no
  shared schema was changed.
- The new activation regression fails on the original source and passes on the
  patch. Both focused activation tests pass after final helper cleanup.
- Web typecheck passes; complexity guard passes with no functions above 20.
- Parent review: only metadata is selected; newest-trace lookup is indexed and
  capped at one; stale/missing evidence retains the original alert age. No
  production mutation or provider/prompt change. Changelog is not applicable
  for this internal monitoring correction.
- Deployment remains a separate Web-only release. Missing producer evidence
  conservatively retains alerts, so no ordered runtime rollout or migration is
  needed. Exact-head PR CI and applicable final review are release gates.
Completed: 2026-09-29
