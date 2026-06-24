# PR 240 ReviewGPT Round 29 Fix

## Goal

Fix the round 29 ReviewGPT finding without adding scheduler/state complexity:

- opposite-mode runtime fences may be replaced only when the exact persisted container reports no active runtime
- live identity mismatches, probe failures, and missing persisted container names must remain busy/indeterminate

## Constraints

- Keep the existing fence recovery path.
- Do not add TTLs, alarms, or another cleanup service.
- Preserve live opposite-mode work and avoid split-brain runtime starts.

## Current State

- PR #240 is pushed at `034a4c6`.
- CI is green.
- ReviewGPT round 29 found one high issue in the stale opposite-mode fence probe.

## Plan

1. Make the non-waking runtime fence probe return an explicit tri-state.
2. Only allow replacement on explicit inactive from the persisted container name.
3. Add regressions for active identity mismatch and missing persisted container name.
4. Run focused tests, typecheck/diff checks, commit, push, and re-check CI.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
