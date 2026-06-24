# PR 240 ReviewGPT Round 28 Fixes

## Goal

Fix the two round 28 ReviewGPT findings for PR 240 with the smallest durable changes:

- interrupted shutdown maintenance must persist a future inbox media retention retry wake when no better wake was computed
- stale opposite-mode runtime fences must be recoverable without waking or replacing live mismatched work

## Constraints

- Keep the 14-day media retention architecture simple and runtime-owned.
- Do not add another scheduler, TTL service, or persisted cleanup owner.
- Preserve foreground/default work priority and live retention-only isolation.
- Preserve unrelated working-tree changes.

## Current State

- PR #240 branch is pushed and CI is green at `eea3f2c`.
- ReviewGPT round 28 found two high issues in shutdown retry wake selection and opposite-mode stale fence recovery.

## Plan

1. Inspect existing idle-maintenance interruption and fence-recovery helpers.
2. Remove caller inference from shutdown retention retry selection.
3. Reuse the existing non-waking liveness probe and replace path for inactive mismatched fences.
4. Add focused regression tests.
5. Run targeted verification, typecheck/diff checks, commit, push, and re-check CI.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
