# Preserve restored device-sync retry progress

Status: completed
Created: 2026-09-07

## Outcome and evidence

Review of PR #3020 found that cold restoration resets local attempt counters.
A restored retry can therefore appear untouched despite a saved cursor and
reduced remaining budget. Overflow must retain that exact checkpointed work.

## Implementation

Re-derive Web replay equivalence during existing dirty admission, comparing
kind, manifest-safe execution payload, priority and remaining attempt limit.
Only positively proven payloads may be deferred. Keep proof transient and reuse
the existing bounded job query; no new persisted state or database operations.

## Verification and completion

Exercise an actual failed-job transition, a cold restore with child overflow,
and another restore. Prove the old patch loses the retry and the correction
preserves cursor and budget. Rerun focused runtime suites and typecheck, review
complexity and docs, then commit and request the combined candidate's second
external review concurrently with exact-head CI.

## Results

The new regression fails on the previous patch because overflow drops the
checkpointed retry. The correction preserves cursor and four remaining attempts
through both cold restores. All 329 focused runtime tests, runtime typecheck,
complexity guard and docs drift pass. Parent review confirms no new remote calls
or durable protocol fields. Product recovery remains Ready. The final external
review and required CI will run on the combined pushed candidate.
Updated: 2026-09-07
Completed: 2026-09-07
