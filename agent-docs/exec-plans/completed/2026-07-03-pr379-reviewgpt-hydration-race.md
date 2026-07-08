# PR 379 ReviewGPT Hydration Race

Status: completed
Updated: 2026-07-03

## Goal

Resolve the ReviewGPT round-6 finding for PR #379: hosted hydration must not
drop a locally owned Junction historical-backfill retry wake or metadata after
a hosted control-plane version-mismatch/concurrent-update race.

## Constraints

- Preserve the PR's simple owner shape: derive backfill work from connection
  metadata and `nextReconcileAt`; do not add a retry queue, scheduler, or new
  state owner.
- Keep foreground priority unchanged; backfills remain background work.
- Treat ReviewGPT findings as inputs, not architecture instructions. Accept
  only findings proven against the current code path.

## Current State

- Round 6 reviewed pushed PR head `d0d54d7` and reported one High finding.
- Triage is in progress against hosted hydration and device-sync store tests.

## Planned Proof

- Add a focused hosted hydration regression for local retry metadata plus an
  earlier local `nextReconcileAt` surviving a concurrent hosted version move
  without marking unpublished local progress as hosted-observed.
- Run the focused owner tests, then the repo-required verification lane for the
  touched files.
- Commit, push, and rerun ReviewGPT against the pushed head.
Completed: 2026-07-03
