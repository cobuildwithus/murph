# PR 752 ReviewGPT round 2 remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Prevent legacy WHOOP sleep-type metadata enrichment from replacing a newer
  canonical event revision created through the supported event-edit path.

## Success criteria

- A production-path regression proves that a temporal/source-only edit with
  unchanged notes, tags, and links remains canonical during enrichment.
- Untouched legacy sleep rows still receive provider-owned `sleepType`
  metadata; deleted or edited rows remain unchanged; unrelated snapshot
  resources still commit; exact replay remains storage-idempotent.
- Focused owner tests, typechecks, diff/privacy guards, CI, and the next
  ReviewGPT round pass on the exact pushed PR head.

## Scope

- In scope: the narrow legacy WHOOP sleep-type exception in core, its focused
  regression coverage through the supported event-edit owner, verification,
  current-main reconciliation, the minimum compatibility adaptation required
  to keep the PR's finite support-series contract behind the new root-only
  hosted automation tool, PR metadata, CI, and ReviewGPT.
- Out of scope: generic device conflict semantics, provider normalization,
  schema changes, unrelated sleep-loop behavior, deployment, and merging the
  PR.

## Constraints

- Preserve the latest canonical event revision as the sole user-facing truth.
- Do not turn the metadata backfill into a generic same-version conflict
  exemption or block unrelated resources in a mixed snapshot.
- Keep package dependencies one-way and place the production-path test in an
  owner that already depends on both the event usecase and core.

## Tasks

1. Reproduce the ReviewGPT finding through the supported edit path.
2. Apply the smallest revision-ownership guard and update focused coverage.
3. Run scoped verification and parent final review; close the plan and commit.
4. Push the correction, start the next ReviewGPT round alongside CI, and
   resolve any further accepted findings without merging the PR.

## Decisions

- Treat any canonical revision newer than the indexed provider revision as an
  edit that the legacy metadata backfill must not replace, regardless of which
  mutable field changed.
- Keep that revision comparison inside the recognized-enrichment preserve path.
  Folding it into enrichment recognition would turn an edited sleep row into an
  equal-version conflict and abort unrelated resources in the same snapshot.
- The latest `main` deleted the hosted CLI bridge and moved hosted automation
  mutations behind an accepted-input-scoped `murph.automation` tool. Preserve
  that simpler authority boundary: carry `activeUntil`, `supportKind`, and
  `supportSeriesId` through the root tool and add exact-series reconciliation;
  do not restore the bridge or permit model-controlled reserved tags/routes.

## Verification

- Before the production correction, the new real-vault test reproduced the
  bug: the supported edit was displaced by revision 3 instead of remaining
  revision 2.
- After the correction, that test passed through real query, edit, core upsert,
  provider reconciliation, unrelated-resource commit, and replay paths.
- The real-vault regression passed again after session recovery (1/1), and the
  existing core mixed-snapshot WHOOP enrichment proof passed (1/163 selected).
- Current-main conflict resolution passed 104 assistant prompt/skill/tool
  tests, 46 managed-automation tests, 19 CLI automation tests, and the hosted
  accepted-input runtime test. Assistant-engine and assistant-runtime builds,
  CLI typecheck/build, and generated CLI artifacts passed.
- The required coverage-write pass added one test-only exact-series proof:
  reconciliation archives an active stale member, preserves a paused member,
  and leaves another series active. Its selected runtime test passed; selected
  coverage commands executed all chosen tests but, as expected for single-file
  runs, did not meet package-wide global coverage thresholds.
- The first final `test:diff` attempt passed global safety, dependency,
  boundary, prepared-runtime, and affected CLI typecheck gates before two
  unrelated CLI expansion cases timed out at exactly 60 seconds during
  concurrent coverage work. Both cases passed alone immediately afterward in
  9.1 and 8.0 seconds.
- A clean second `test:diff` run passed every global guard, all 371 CLI tests,
  all 15 affected typechecks, and the affected package suites except for one
  unchanged core stress case that exceeded its 60-second per-test limit and
  the assistant-engine scripted runtime file under the concurrent fanout.
  Sequential replacements passed: the unchanged core stress case completed in
  73.9 seconds with a 180-second runner limit, and all 13 scripted runtime
  cases passed. No production or test timeout was changed.
- `docs:drift`, `git diff --check`, conflict-marker inspection, and the
  identifier/privacy scan passed. Pending exact-head CI and ReviewGPT round 3.
Completed: 2026-07-16
