# Retired device-sync wake dedupe

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Stop scheduled device-sync recovery sweeps from failing when an unchanged,
  runtime-imported wake crosses mailbox content retention while preserving
  privacy deletion, exact generic dedupe, and the existing runtime retry owner.

## Success criteria

- A content-retired scheduled wake that the runtime already imported is treated
  as the same durable schedule tuple without restoring retired payload content.
- A content-retired wake that was never imported is not silently accepted.
- Live mailbox rows keep exact kind, lane, schema, byte-count, and hash conflict
  detection.
- First insert remains the only direct Temporal handoff for scheduled wakes;
  unchanged duplicates do not manufacture a second identity or signal.
- Focused regression tests and the hosted Web typecheck pass.

## Scope

- In scope: scheduled device-sync wake append/recovery behavior at the mailbox
  retention boundary, focused tests, protocol documentation, and the public
  changelog decision.
- Out of scope: retention duration, generic mailbox dedupe semantics, provider
  cadence, runtime retry scheduling, and unrelated recovery routes.

## Constraints

- Preserve the 14-day content-retirement privacy boundary and stable v3 event
  identity.
- Preserve foreground priority, bounded sweep cardinality, and short
  database-only transactions.
- Use the smallest existing owner boundary; add no queue, schema, dependency,
  or process.

## Evidence

- A production sweep selected four due connections; two inserted successfully
  and two stable scheduled-wake identities hit `mailbox.dedupe_conflict`.
- Both conflicts referred to existing v3 system-lane `device-sync.wake` rows
  whose retention sweep had cleared payload bytes and hashes; the rebuilt
  requests carried valid byte counts and hashes.
- The affected mailbox rows had already advanced the runtime-imported system
  watermark but remained ahead of the handled/consumed frontier, so persisted
  runtime retry—not a new Web signal—owned continuation.
- The unchanged schedule tuples had remained overdue for roughly fourteen days;
  two more live wake rows were near the same retention boundary.
- Static tracing confirms retention clears payload metadata, generic append
  compares that metadata exactly, scheduled wake identity stays stable for the
  unchanged tuple, and any rejected wake makes the recovery route return 500.

## Product UX patch

- People: existing members whose connected-device schedule remains pending long
  enough for its imported mailbox content to retire; ordinary connected-device
  members whose live wakes still need exact dedupe protection.
- Expected experience: the recovery sweep stays healthy while the imported
  runtime retry continues owning the stale tuple; normal new or changed work
  keeps existing behavior and foreground conversations remain prioritized.
- Recovery: never-imported retired content remains a real recovery failure so
  missing runtime ownership cannot be hidden.

## Tasks

1. Completed: give ReviewGPT the privacy-safe production evidence and
   implementation constraints; its runs confirmed the boundary but returned
   no complete patch artifact.
2. Completed: implement the narrow producer-owned duplicate classification
   without weakening generic mailbox dedupe or adding redundant state.
3. Completed: run focused regressions and hosted Web typecheck, then complete the
   Product UX walkthrough and parent diff review.
4. Completed: publish the member-visible reliability changelog, commit through
   the plan-aware path, open a draft PR, and prepare the exact-head CI and
   ReviewGPT gates required for this sensitive runtime change.

## Decisions

- Treat a canonical runtime import beyond the handled frontier and within the
  allocated high-water mark as evidence that a content-retired stable wake
  still has a continuation owner; retention alone is insufficient.
- Keep the exception producer-specific or equivalently narrow. Generic mailbox
  duplicate comparison remains exact for live payload metadata and unrelated
  kinds.

## Verification

- Passed the scheduled-retention PostgreSQL proof: 10 tests, including strict
  generic dedupe, imported/unhandled acceptance, and malformed, overflowing,
  non-string, beyond-high-water, handled, sidecar, occurrence, and legacy-v2
  rejection cases.
- Passed the device-sync wake suite (192 tests), generic mailbox store suite
  (73 tests), and three recovery-sweeper suites (13 tests).
- Passed hosted Web typecheck, focused ESLint, `git diff --check`, and the
  identifier privacy scan.
- Passed the four focused changelog suites (59 tests) after adding the
  member-visible reliability entry.
- Exact pushed-head CI and final ReviewGPT review launch after this
  implementation plan is archived into the candidate.
Completed: 2026-09-03
