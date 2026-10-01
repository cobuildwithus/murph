# Vault CLI Activity Recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Make workout, measurement, exercise-catalog, and scheduled-log failures produce
privacy-safe machine envelopes that tell an assistant exactly what can be
corrected, while rejecting misleading writes and preserving canonical vault
ownership.

## Root Cause

- Some command-owned Zod validation stores detailed issues only in private
  context or throws raw parse errors, so the bounded repair transport cannot
  project the field paths.
- Scheduled-log typed action branches silently ignore flags owned by another
  action kind, and status mutations throw untyped missing-record errors.
- Measurement date-only normalization does not receive the explicit event
  timezone even though the resulting payload stores that timezone.
- Exercise-catalog artifact initialization can surface an unclassified raw
  filesystem or artifact-shape exception.

## Architecture

- Command and usecase owners construct the foundation's explicit bounded repair
  contract; the shared transport remains unchanged and arbitrary context is
  never serialized.
- Scheduled-log commands validate action-family flags before the canonical core
  write and map only proven scheduled-log owner errors into stable CLI codes.
- Measurement passes the already-validated explicit timezone to the existing
  date-only normalization owner; no second timestamp implementation is added.
- Exercise commands classify catalog initialization failures at their local
  boundary with value-free categories and recovery guidance.

## Product UX Patch

- Outcome: a model can correct malformed activity and schedule input, re-list a
  missing target, or stop on an unavailable catalog without guessing or
  believing discarded data was saved.
- Reaches: existing local and hosted assistant calls through `murph` and
  `vault-cli` for workout, measurement, exercise, and scheduled-log commands.
- Proof: exact machine-envelope tests assert stable codes and bounded field
  paths without submitted-value echo; write tests prove incompatible flags fail
  before persistence, and timezone readback proves the explicit zone determines
  a date-only instant.

## Work

1. Inspect the foundation repair contract and the exact command/usecase error
   owners; preserve the foundation transport unchanged.
2. Migrate workout and scheduled-log validation producers to explicit bounded
   repairs and reject action-family flag conflicts before writes.
3. Add typed scheduled-log missing/conflict/read/parse classifications only
   where the existing owner evidence supports them.
4. Add safe exercise artifact failure categories and pass explicit measurement
   timezone into date-only normalization.
5. Add focused machine-envelope, non-echo, rejection-before-write, and
   canonical-readback regressions.
6. Run focused CLI tests, package typechecks, inspect the final diff, and close
   this plan with `scripts/finish-task`.

## Outcome

- Workout and scheduled-log validation now supplies bounded, value-free field
  recovery through the shared machine envelope.
- Scheduled-log typed saves reject action-family flags that would otherwise be
  discarded, and missing/conflicting/invalid registry paths have stable codes
  and next actions.
- Exercise catalog initialization distinguishes invalid artifacts from an
  unavailable catalog without surfacing artifact internals.
- Date-only measurements resolve their instant from the explicit event timezone
  and persist that same timezone for truthful canonical readback.

## Verification

- Focused source-first Vitest files for workout, measurement, exercise, and
  scheduled-log behavior.
- CLI and affected owner-package typechecks after the final TypeScript edit.
- Exact JSON/full-output envelope assertions for codes, field paths, hints, and
  absence of submitted values or local paths.
- Canonical vault readback proving rejected scheduled-log input writes nothing
  and a date-only measurement uses the explicit IANA timezone.

Completed proof:

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/workout-add-typed-parity.test.ts packages/cli/test/scheduled-log-save-typed-parity.test.ts packages/cli/test/exercise-command-coverage.test.ts packages/cli/test/measurement-add-typed-parity.test.ts` — 38 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/scheduled-logs.test.ts` from `packages/query` — 3 tests passed.
- `pnpm --dir packages/cli typecheck` — passed.
- `pnpm --dir packages/query typecheck` — passed.
- `git diff --check` — passed.

## Deferred

- The parent integration owns the consolidated changelog and PR workflow.
- Other audited CLI families remain in their independently assigned slices; the
  shared foundation transport was intentionally not changed here.
Completed: 2026-08-24
