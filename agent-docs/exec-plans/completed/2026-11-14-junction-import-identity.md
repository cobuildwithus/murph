# Junction import identity: one id per sample and per sleep session

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- Stop three ways the same Junction fact is stored or counted more than once:
  a timeseries sample re-read by the daily reconcile, a sleep session whose
  start or end the provider later rewrites, and a source's partial timeseries
  day total counted beside its own activity summary.

## Success criteria

- One timeseries sample imported by the data-webhook fetch and by the reconcile
  re-read reaches the importer with the same source instance id, for every
  timeseries resource.
- A sleep session whose end is rewritten keeps one live total and one live
  record per stage, with the same event ids.
- A stale window copy already in a vault never makes a later import fail.
- A source's steps, distance or floors timeseries total is not a candidate on a
  date that source has an activity summary for; it still stands in on a date
  without one.

## Scope

- In scope: `packages/device-syncd` reconcile identity projection,
  `packages/importers` sleep stage and total refs, the matching legacy-ref rule
  in `packages/core`, and candidate collection in `packages/query`.
- Out of scope: deleting or rewriting records already stored in any vault; the
  wearable comparator and the worn-device steps rule; skipping all-null activity
  updates at admission (see Decisions).

## Constraints

- Technical constraints: stored event ids must not change for records that are
  consistent today. No query projection version bump: stored evidence re-ranks
  at read and replicas rebuild on the next source change.
- Product/process constraints: `device-sync-ingestion-invariants.md`, in
  particular that no webhook branch completes without import-or-fetch.

## Risks and mitigations

1. Risk: re-keying records that are consistent today creates new duplicates.
   Mitigation: only the resource family whose two paths already disagree is
   aligned; a test runs every timeseries resource through both paths.
2. Risk: a window legacy ref matches a stale copy while the session already
   owns a record, and core refuses the whole import as an ambiguous merge.
   Mitigation: core ignores a superseded window ref once the session ref has
   an owner; a test stores the stale copy first and then delivers a late
   payload.
3. Risk: a sleep cycle without a session id stops sharing its owner with an
   id-keyed summary.
   Mitigation: stored data shows the cycle's `sleep_id` equals the summary's
   `id` on every night that has both; a record with no id keeps the window key.

## Tasks

1. Prove the duplicate-id claim with a test that imports one sample by both
   paths, then align the reconcile path for the resources that disagree.
2. Key sleep total and stage refs on the session id, with the window ref as a
   legacy ref, and make the summary own its session's stages by id.
3. Add the core rule for a superseded window ref.
4. Drop a source's timeseries day total beside its own activity summary.
5. Record the two identity contracts in the ingestion invariants doc.

## Decisions

- The reconcile path projects the account source identity only for the
  resources whose data-webhook fetch already does. Projecting it for every
  resource would re-key steps, distance, active calories, heart rate and the
  bounded-record resources, which are consistent on both paths today.
- Session-keyed refs use the `sleep-session-` prefix so core can tell them
  from the `sleep-stage-` window refs they supersede.
- Two existing sleep tests gained `sleep_id` on their cycle fixtures: sharing
  one owner across separate imports now follows the session id, which every
  real cycle carries.
- A timeseries total dropped as a candidate is named in the dataset's metric
  suppression evidence. Losing candidates are what suppress their raw
  observations as metric points, so dropping one silently would have let the
  partial totals reach goal and experiment aggregates (final review, round 1).
- Skipping an all-null activity update at admission was built and then left
  out. It is an import-vs-skip gate on the webhook path, which the ingestion
  invariants forbid; that exception is the owner's decision.
- Records already stored under superseded ids are left alone. See the PR body
  for how they can be found.

## Verification

- Commands to run: `pnpm test:diff` over the touched packages; package
  typechecks; the three new test files.
- Expected outcomes: all green; the new identity test fails for 11 resources
  without the reconcile change and the stored-count test reports 3 candidates
  without the query change.
Completed: 2026-11-14
