# Bound sparse calendar validation retries

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Keep deterministic Junction calendar normalization failures on the existing
30-minute validation cadence through hosted cold restore.

## Scope and constraints

Local code, synthetic tests, owner documentation and a scoped commit only.
No production access, push, PR, new persisted state or normalization relaxation.

## Tasks

1. Trace remaining-budget handoff, retry deadlines and strict row validation.
2. Reproduce the short retry with synthetic warm/cold tests.
3. Reuse the existing validation retry rule, verify and review the diff.

## Decisions

Hosted job hints carry remaining attempts and absolute availability; local
attempt counters restart on cold hydration. Keep that existing protocol and
remove the blood-oxygen restriction on calendar normalization retry policy.
Complete-day replacement must continue rejecting incomplete rows.

## Product UX

Outcome: failed calendar refreshes wait 30 minutes while preserving prior data.
Reaches: all sparse calendar resources; unrelated jobs and corrected responses.
Proof: repeated validation, warm/cold restore, no early execution, eventual success.

## Verification

Base regression: all three sparse resources failed the 30-minute assertion in
the service test (15 seconds) and the hosted test (5 seconds remaining after
10 seconds of simulated checkpoint work). The hosted test reaches actual
mailbox recording, cold hydration, a zero attempt count and refusal to claim
before that preserved deadline before asserting the slow cadence.

Focused commands (from each named package, using its `vitest.config.ts` and
`--no-coverage`):

- device-syncd: `pnpm exec vitest run test/service.test.ts test/store.test.ts test/junction-provider-diagnostics.test.ts`.
- assistant-runtime: `pnpm exec vitest run test/hosted-device-sync-runtime.test.ts`.
- importers: `pnpm exec vitest run test/device-providers-junction.test.ts`.
- runtime-state: `pnpm exec vitest run test/hosted-bundle.test.ts -t 'revalidate preserved artifact refs|collapse into one workspace bundle'`.
- `pnpm --filter @murphai/device-syncd --filter @murphai/assistant-runtime --filter @murphai/importers typecheck`.
- `pnpm complexity:diff`; `git diff --check`.

Results: device-syncd 317 passed (205 service, 66 store, 46 provider diagnostics);
assistant-runtime 166 passed; importers 270 passed; runtime-state two selected
snapshot tests passed. The store run first exposed the deliberately changed
five-attempt retained allowance; its expectation was updated and all 66 store
tests reran green. After strengthening the hosted checkpoint assertion, all
five validation cases reran green. All three package typechecks passed, with
the two changed test owners rechecked after final edits. Complexity and diff
checks passed; existing service hotspots did not grow.

Product UX: Ready. Tests cover repeated validation beyond the initial allowance,
warm persistence, cold reset with preserved availability, no execution before
the deadline, independent sibling work, transport failures and corrected data.

## Root cause evidence

1. `packages/runtime-state/src/device-sync-local-state-descriptors.ts:6`
   classifies the job database subtree as machine-local;
   `src/hosted-bundles.ts:2189` excludes it from portable runtime snapshots.
   The retained mailbox journal is the existing recovery owner.
   `packages/assistant-runtime/src/hosted-device-sync-runtime.ts:1114` serializes
   pending jobs with their absolute availability and remaining attempt budget,
   without lifetime attempts. Its hydration path at line 1028 enqueues those
   hints; `packages/device-syncd/src/store/jobs.ts:1297` inserts attempts zero.
   Claim increments it, and `failJobIfOwned` at line 831 retained sparse jobs
   with at least `attempts + 1` before this fix. Each cold failure therefore
   repeats attempt one and the first `computeRetryDelayMs` slot
   (`packages/device-syncd/src/shared.ts:112`). Warm restarts keep the counter.

2. Availability is preserved, not ignored. The store's next-job projection
   (`jobs.ts:332`) selects the earliest availability; its claim at line 394
   requires that time to be due. Maintenance reads that projection
   (`packages/assistant-runtime/src/hosted-runtime/device-sync-maintenance.ts:509`)
   and records it with the retained wake. Mailbox checkpoint recording keeps
   the wake and next attempt (`system-mailbox.ts:1423`). The synthetic regression
   proves how a 15-second retry can be only five seconds away after checkpoint
   work. Exact elapsed production timing cannot be established without aligned
   failure/checkpoint timestamps; no production access was performed.
   Progress fingerprints (`device-sync-maintenance.ts:1919`) intentionally omit
   availability and attempts, so an unchanged fingerprint does not prove the
   retry deadline was lost.

3. `packages/importers/src/device-providers/junction.ts:2415` requires a source
   context, finite value accepted by the resource normalizer, valid start/end
   with end >= start, the exact authorized day/provider, and any requested
   source type/instance. Any failed predicate emits `sparse_interval.row_incomplete`.
   Caffeine additionally accepts only 0..2 grams (`junction.ts:11023`).
   [Junction's caffeine schema](https://docs.junction.com/api-reference/data/timeseries/caffeine.md)
   requires unit, deprecated timestamp, start, end and numeric value; units are
   grams and no numeric maximum is specified. Source provider is required,
   while source type defaults to unknown and instance fields are optional.
   The new synthetic normalizer proof accepts valid Apple Health intervals and
   distinguishes multiple field combinations that all produce absolute/UTC
   rejection metadata. That metadata cannot prove which predicate failed or
   whether the rejected row violates the provider schema versus Murph's stricter
   value or source/day requirements. No universal Apple Health shape defect is
   established, and no normalizer behavior was changed.

## Choice and limits

- Carrying lifetime attempts would require extending the hosted hint/restore
  contract: remaining budget alone cannot reconstruct them. That is broader
  than this fix and still starts with rapid retries. Without that change,
  other attempt-based failures can still restart their backoff on cold restore.
- Reusing the existing fixed validation rule by deleting its blood-oxygen
  restriction handles deterministic normalization failures immediately, with
  no new state, config, queue or timer. Both service and SQL predicates use the
  same classification and existing transport allowance. Omitting this change
  leaves the demonstrated cold retry loop.
- Skipping a failed row would certify an incomplete source-day replacement,
  potentially lowering totals or removing prior evidence. Keep strict import;
  the affected day remains pending until a complete valid response arrives.

Fresh accepted corrections and unrelated due jobs retain their own admission
rules; the change bounds retries caused by these validation failures. Existing
terminal errors, account/lease fences and canonical replacement remain intact.

## Delivery and review

Deploy surface: rebuild and release the hosted runner image containing
device-syncd. Web-only deployment cannot ship this behavior; no schema migration
or new reader protocol is required. No deployment or external review was run in
this local-only task. Parent review covers the complete diff and source/state
boundaries. No public changelog: this is internal retry scheduling, preserving
the existing data and completion contract.
Completed: 2026-11-10
