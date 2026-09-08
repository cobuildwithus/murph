# Runtime Progress Alert Diagnostics

## Goal

Make the next durable mailbox-progress alert directly distinguish an imported
system frontier from an unimported handoff, identify the current wake owner,
and correlate the affected runtime with the exact runner release and terminal
mailbox frontier in existing privacy-safe runtime logs.

## Evidence

- Two production alerts with similar aggregate counts came from different
  runtimes and different failure boundaries.
- Existing snapshot and dirty-ack failure logs proved the immediate failures,
  but the aggregate alert did not preserve enough classification to select the
  matching runtime without reconstructing historical orchestration facts.
- The terminal `runtime.invocation_finished` event records only processing
  mode. It omits the public runner release, selected wake, and derived system
  mailbox frontier, so current evidence cannot prove the exact persisted shape
  of an older retained device item.
- The existing alert and runtime-log owners already carry all required facts;
  no new scheduler, state owner, schema, identifier, or payload logging is
  needed.

## Constraints

- Keep alert email and persisted incident evidence aggregate-only. Do not add
  member, runtime, mailbox-item, connection, provider, message, or health-data
  identifiers.
- Runtime logs may add only public release identity, wake metadata, numeric
  derived mailbox frontiers, and bounded classifier-failure codes. Do not log
  payloads, raw errors, or private ids.
- Preserve the alert predicate, five-minute scan, 15-minute threshold,
  singleton incident lifecycle, reminders, quiet-hour policy, and silent
  recovery behavior.
- Add no database migration, cross-database join, new log event type, or alert
  query outside the existing bounded candidate scan.

## Plan

1. Extend the existing progress-row projection with numeric high-water,
   consumed, and imported frontiers already present in the query.
2. Derive aggregate system diagnostics for head type, import coverage,
   imported-but-unhandled count, and wake-owner class; include them in the
   persisted incident and email.
3. Enrich the existing terminal invocation log with result status, selected
   wake, public runner release SHA, and derived system imported/handled/first
   pending sequences. Persist and log bounded failure codes for the exact
   retained-device-retry predicates that the first pending item did not meet.
4. Add focused privacy and behavior tests, update the live reliability and
   verification contracts, and run affected tests, typechecks, lint, diff
   checks, final review, exact-head CI, and ReviewGPT.

## Verification

- `pnpm --dir apps/web test:prepared -- hosted-runtime-progress-alert-monitor.test.ts`
  passed all 17 focused tests, including every import-coverage and wake-owner
  diagnostic bucket.
- Focused Assistant Runtime Vitest passed the mailbox-state,
  mailbox-checkpoint, and workspace-entrypoint files, 58 tests total.
- The five additional workspace-entrypoint files affected by strict result
  fixtures plus mailbox-state coverage passed 169 tests. Full Assistant
  Runtime coverage passed 2,691 tests with five intentional skips across 117
  passing files and one skipped file; package coverage thresholds remained
  green.
- `pnpm typecheck` passed independently in `apps/web` and
  `packages/assistant-runtime`.
- The Web-owned ESLint configuration passed both changed Web files. Assistant
  Runtime has no package or root ESLint configuration; its package typecheck is
  green.
- `pnpm complexity:diff` passed without increasing complexity debt or maximum
  complexity in any changed source owner.
- `git diff --check` passed. CI on the first reviewed head passed every Web,
  Cloudflare, build/typecheck, host-matrix, Temporal, billing, hygiene, and
  package lane except platform-a coverage, whose only failures were five exact
  result fixtures missing the new optional `null` field. Those fixtures are
  corrected and proven locally; final-head CI, ReviewGPT completion, merge-tree
  proof, and final plan closure remain PR-stage gates.

## State

Status: completed
Updated: 2026-09-08

## Authorized takeover

- The user requested takeover and landing after confirming no active owner.
  The existing branch was clean and its published head unchanged. This task
  owns the existing PR and worktree through completion.
- Reconcile current main with an ordinary merge, preserving the newer explicit
  device-sync continuation owner and bounded alert scan. The diagnostic codes
  must describe that current authority rather than obsolete retry scheduling.
- Correct two source-confirmed advisory observations: imported frontiers above
  durable high water are unknown, and a system-mailbox return without a
  checkpoint still needs current terminal progress evidence.
- ReviewGPT authors the implementation patch; local work owns inspection,
  focused verification, Git operations, evidence, and completion.
- The two files responsible for the prior assistant-engine CI failure now pass
  all 104 tests with current main. An isolated local PostgreSQL database is
  prepared for direct query proof. These results do not replace validation of
  the final diagnostic patch or exact-head CI.
- Two pre-send ReviewGPT staging attempts failed (surface confirmation and
  attachment confirmation). A fresh managed lane accepted the implementation
  request; no duplicate accepted request was sent.

## Takeover verification

- Accepted the ReviewGPT-authored patch after source inspection. The patch
  reconciles explicit continuation ownership, restores the diagnostic SQL
  projection, classifies impossible imports as unknown, and shares the current
  mailbox read between return-time progress and wake selection.
- Focused Assistant Runtime proof: 216 tests passed across seven mailbox,
  checkpoint, startup, restore, scheduling, preemption, and system-mailbox files.
  The existing projection-deferral journey now proves complete terminal
  progress, the same selected wake, and zero checkpoint requests.
- Web monitor unit tests: 19 passed. Five focused PostgreSQL scenarios passed,
  including impossible-frontier classification and equality coverage. The
  unchanged large-cardinality scenario exceeded its existing transaction
  timeout. The exact merged base also timed out in the same test (240 seconds),
  so this is a pre-existing local stress-proof limitation, not a demonstrated
  diagnostic regression. The accepted source was restored byte-for-byte.
  This reuses the large-PostgreSQL-fixture friction tracked in issue #2804.
- Web and Assistant Runtime typechecks, changed Web ESLint, documentation drift,
  and whitespace checks passed. The complexity guard passed against the exact
  merged base: no changed-file debt or maximum increase across four source
  owners. Existing runtime orchestration and parser hotspots remain unchanged;
  diagnostic helpers are below the threshold and reuse existing owners.
- Internal-only diagnostic change: no member-facing UX or changelog item.
  No provider input, scheduling policy, schema, new query, or durable owner.
Completed: 2026-09-08
