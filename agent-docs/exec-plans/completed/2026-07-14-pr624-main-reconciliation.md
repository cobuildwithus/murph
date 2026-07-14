# PR 624 main reconciliation

## Goal

Preserve the still-applicable ReviewGPT fix after current `main` deleted the
retired route-authority machinery: migrate the legacy pending-reply index in
small, abortable background batches without delaying fresh foreground replies.

## Scope

- Add deterministic, bounded input-store pagination for migration.
- Persist a resumable pending-reply backfill cursor.
- Keep foreground selection read-only with respect to legacy migration.
- Continue background migration with an immediate wake and checkpoint its
  runtime-state progress without reporting semantic assistant progress.
- Delete all route-proof-specific portions of the superseded PR patch.
- Add focused migration, selection, maintenance, and checkpoint regressions.

## Invariants

- Fresh inbound replies are never blocked by legacy backfill.
- Each migration pass reads and classifies at most four input records and honors
  abort/yield signals.
- Existing indexed replies remain eligible while migration continues.
- Migration-only writes are durably checkpointed and do not invent assistant
  progress.
- The retired route-authority and repair surfaces remain deleted.

## Verification

- TypeScript 7 package typechecks passed for assistant-engine, assistant-runtime,
  assistant-cli, assistantd, setup-cli, and CLI.
- Focused migration/maintenance/checkpoint tests passed (38 assistant-engine;
  427 assistant-runtime), followed by full assistant-engine (2,142 passed, 4
  skipped) and assistant-runtime (1,619 passed, 2 skipped) suites.
- Assistant CLI (128), assistantd (40), and setup CLI (124) suites passed.
- Cloudflare verification passed (1,779 tests across 103 files).
- The diff-aware lane's CLI worker exceeded its local load window; the exact
  unrelated workout-command timeout reproduced from a clean `origin/main`
  worktree, where an additional test in the same file also timed out.
- Coverage-write, security/privacy, and simplify completion audits are clear.

## Status

Complete. The PR-specific head still requires the normal ReviewGPT and CI loop
after publication.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
