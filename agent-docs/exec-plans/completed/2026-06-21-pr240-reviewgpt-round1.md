# PR 240 ReviewGPT Round 1

## Goal

Resolve accepted ReviewGPT findings for PR 240 without expanding the retention architecture beyond the existing vault, inbox, and hosted idle-maintenance primitives.

## Constraints

- Keep the 14-day inbox media policy simple: durable media requires explicit pin/promotion; retention defaults to deletion.
- Avoid a new scheduler, state owner, queue, service, or reconciliation loop unless a failing test proves the existing idle checkpoint cannot carry the wake.
- Do not add generic raw-file deletion capability to core write batches unless a non-retention owner needs it.
- Preserve tombstones as the durable source of truth for intentional expiration, but do not let tombstones mask unrelated broken references.

## Accepted Findings Under Triage

1. Retention needs an automatic wake for future eligibility and unfinished batches.
2. Raw media deletion should not flow through write-batch backups.
3. Tombstone validation must be scoped to the inbox capture attachment that expired.

## Verification Plan

- Focused inboxd, assistant-runtime, and core tests for the changed behavior.
- Focused typechecks for touched packages.
- Repo-required verification before commit.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
