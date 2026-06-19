# Auto-reply suppression atomic commit

Status: completed

## Goal

Make grouped assistant auto-reply terminal suppression durable and replay-safe by
recording one committed suppression fact before per-input evidence projections
are treated as complete.

Success criteria:

- A grouped terminal suppression decision is committed once for all accepted
  input ids and optional inbox capture ids before projection writes.
- Scanner suppression decisions can be repaired from the committed fact and no
  longer depend on all per-input evidence files being present.
- Focused tests cover partial projection failure, captureless scanner repair,
  and capture-backed scanner repair before provider retry.

## Constraints

- Preserve existing assistant runtime ownership under
  `.runtime/operations/assistant/**`; do not promote no-reply state into
  canonical vault truth.
- Keep the change narrow to assistant-engine state and tests.
- Avoid prompt/planning changes; the returned review's exact no-reply symbols
  are absent on this base, so keep the fix to the applicable existing
  auto-reply suppression evidence flow.
- Do not touch active homepage or hosted-runtime dirty work in the main
  checkout.

## Returned Review Source

The retained ChatGPT review reported that grouped suppression evidence and
follow-on no-reply projections could become separate commit points. The exact
reviewed symbols (`finish_without_reply`, final-action patches, transcript
markers, and native resume invalidation) are not present on this base, so this
task applies the returned bug class to the existing grouped auto-reply terminal
suppression evidence path.

## Plan

1. Trace the current auto-reply terminal suppression path and identify the
   smallest existing assistant runtime state owner suitable for the commit.
2. Add the suppression commit/read/repair primitive and wire scanner repair
   before provider processing.
3. Add focused tests for grouped partial projection failure, captureless repair,
   and capture-backed repair.
4. Run required verification, completion audits, final review, and scoped commit
   with `scripts/finish-task`.

## Progress

- Implemented suppression commit storage under assistant runtime
  `auto-reply/suppression-commits/`.
- Implemented projection repair from the commit before scanner provider retry.
- Added focused tests for partial evidence projection repair and both
  captureless and capture-backed scanner repair paths.
- Verification passed: focused assistant-engine Vitest, `pnpm typecheck`, and
  scoped `pnpm test:diff`.
- Coverage-write audit added the capture-backed scanner proof and reran focused
  Vitest plus scoped `pnpm test:diff`, both passing.
- Deep-review audit found subset-repair and commit/index crash-ordering gaps;
  both were fixed and re-reviewed.
- Security/privacy review found no medium-or-higher issues.

## Verification Target

- `pnpm typecheck`
- `pnpm test:diff <touched files>`
- Any package-local assistant-engine coverage command if `test:diff` is not a
  truthful coverage-bearing lane.
Updated: 2026-06-19
Completed: 2026-06-19
