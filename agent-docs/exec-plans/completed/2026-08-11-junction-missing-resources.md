# Model bounded Junction missing resources

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Give every currently absent Junction health resource an explicit, truthful
  Murph policy and implement the useful canonical paths without retaining raw
  historical timeseries. Preserve a small, composable architecture: one static
  policy drives admission, fetching, webhook recognition, history, and
  canonicalization, while dedicated high-volume resources retain bounded
  derived facts only.

## Success criteria

- The 25 absent timeseries resource names and dedicated `workout_stream`
  resource are modeled exactly once in the owning static policy.
- Sparse clinical, metabolic, respiratory, safety, accessibility, body, and
  activity resources have source-aware, replay-idempotent canonical paths with
  compact evidence and appropriate bounded history.
- Dense ECG and workout streams cannot write raw sample arrays or complete
  provider snapshots into vaults; any supported path is opt-in and emits only
  explicitly bounded derived features tied to its source/workout.
- Defaults remain unchanged. Existing members do not begin fetching new
  resources without an explicit code-owned opt-in.
- Configuration, pull fetches, webhook admission, history selection,
  sanitization, and importer dispatch derive from the same static policy rather
  than independently maintained name lists.
- ReviewGPT returns inspectable patch artifacts; only verified hunks are
  applied. Focused tests and typechecks pass, exact-head CI is green, and the
  required preliminary and final ReviewGPT gates have no unresolved findings.
- Each independently reviewable slice is committed and opened as a draft PR by
  the parent Codex session.

## Scope

- In scope:
  - `body_mass_index`, `calories_basal`, `carbohydrates`,
    `daylight_exposure`, `electrocardiogram_voltage`, `fall`, `fat`,
    `floors_climbed`, `forced_expiratory_volume_1`, `forced_vital_capacity`,
    `handwashing`, `heart_rate_alert`, `inhaler_usage`, `insulin_injection`,
    `lean_body_mass`, `peak_expiratory_flow_rate`, `sleep_apnea_alert`,
    `stand_duration`, `stand_hour`, `uv_exposure`, `waist_circumference`,
    `wheelchair_push`, `workout_distance`, `workout_duration`, and
    `workout_swimming_stroke`.
  - Dedicated `workout_stream` webhook recognition, fetch, bounded derivation,
    and canonical ownership, likely as a separate PR from the generic resource
    policy and sparse-resource slice.
  - Focused runtime/provider docs, compatibility matrix, tests, and member-
    visible changelog entries required by the shipped slices.
- Out of scope:
  - Retaining historical raw sample arrays, adding a new vault table, runtime
    registry, queue, service, or synchronization owner.
  - Changing current defaults or silently enabling new resources for existing
    hosted runtimes.
  - Reworking already-admitted resources owned by the separate Junction
    timeseries-fidelity task, or the five already-known-but-blocked resource
    modes owned by the separate configurable-resources task.
  - Provider deployment, credential changes, or live wearable calls.

## Constraints

- Technical constraints:
  - Keep canonical health writes importer/core owned and boot configuration
    free of the turn-scoped importer graph.
  - Preserve source/provider and workout attribution, stable replay identity,
    push/pull complement, current daily facts, and bounded collection fanout.
  - Sparse resources may emit one canonical fact per valid record. Dense/high-
    frequency resources must aggregate before persistence with an explicit
    cardinality ceiling independent of upstream sample count.
  - Use current public Junction resource and endpoint contracts. Summary and
    timeseries availability are independent.
  - No unsafe casts, sibling-internal imports, new dependency, persisted
    compatibility shim, or broad raw snapshot expansion.
- Product/process constraints:
  - ReviewGPT authors patch attachments; the parent inspects, applies, tests,
    commits, pushes, and opens PRs.
  - Preserve unrelated worktrees and changes. Use sanctioned task worktrees.
  - Follow Frog, completion, verification, changelog, PR-description, and exact-
    head ReviewGPT/CI gates.

## Risks and mitigations

1. Risk: a name-only allowlist makes vault size proportional to provider sample
   history.
   Mitigation: encode storage/canonicalization mode and history class in the
   compile-time policy; reject any dense mode without a bounded reducer and
   tests proving raw payloads are absent.
2. Risk: generic numeric handling destroys alert, interval, dosage, or workout
   semantics.
   Mitigation: inspect official record shapes and existing canonical contracts;
   use small shape-specific normalizers where semantics differ.
3. Risk: duplicated resource lists drift across configuration, webhook, fetch,
   sanitization, and import paths.
   Mitigation: derive those surfaces from one lower-layer static owner, retaining
   only purpose-specific projections.
4. Risk: a large all-resource patch obscures architecture and review findings.
   Mitigation: ask ReviewGPT for bounded, compilable patches and split dedicated
   workout-stream/high-volume work into independently reviewable PRs when it has
   a distinct fetch or canonical owner.
5. Risk: another active Junction task edits overlapping policy owners.
   Mitigation: keep this task isolated, exclude its five known resource modes,
   inspect base/head overlap before each PR, and stop rather than overwrite
   unrelated work.
6. Risk: assigning every sparse resource the existing 180-day extended window
   while retaining the generic one-day fetch chunk creates 180 provider calls
   per resource (2,160 calls for the first 12-resource slice per admitted
   source).
   Mitigation: make fetch chunking a policy projection: retain one-day chunks
   for dense streams, but use a larger explicitly bounded sparse window with
   the existing pagination/timeout/yield owner and a tested maximum record
   count. Do not ship the naive multiplied fanout.

## Tasks

1. Trace current configuration, webhook, fetch/history, sanitization, canonical
   event, query, and metric owners; map official Junction record shapes and
   frequencies to bounded modes.
2. Ask ReviewGPT for the first scoped patch implementing the shared static
   policy and sparse-resource slice, including tests and durable docs.
3. Inspect the complete patch, apply only safe hunks, correct any ownership or
   cardinality errors, and obtain follow-up ReviewGPT patches where needed.
4. Run focused tests, package typechecks, direct bounded-retention proofs, full
   diff/privacy review, and the repository completion audits for that slice.
5. Commit with `scripts/finish-task`, push, open a draft PR, and run exact-head
   preliminary/final ReviewGPT gates concurrently with required CI; remediate
   accepted findings.
6. Create sanctioned follow-on worktrees/plans for remaining independent slices
   (including dedicated workout stream), repeat patch/verification/PR gates, and
   leave all requested omissions covered by reviewed PRs.

## Decisions

- Use a compile-time policy rather than a persisted registry. The gap is static
  provider capability metadata, not user/queryable product truth.
- Keep defaults unchanged; all newly supported resources start opt-in.
- Treat `workout_stream` as a dedicated endpoint/resource, not a normal
  `/timeseries/{resource}` entry.
- Do not use summary availability as a substitute for timeseries support.
- Keep ECG waveform and workout sample arrays out of raw receipts and canonical
  evidence; store only bounded features if the shipped slice supports them.
- Extended sparse history does not imply dense one-day fetch chunking. The
  static policy must keep provider-call cardinality proportional to a bounded
  number of sparse windows, not days times every newly admitted resource.
- The existing configurable-resources worktree is now occupied by another task
  for five known-but-blocked resources, so this task uses a separate sanctioned
  worktree and excludes that scope.

## Verification

- Commands will be selected per changed package after ReviewGPT patch review:
  focused contracts/importers/device-syncd/health-metrics/query tests and
  package typechecks, plus direct fixture assertions for stable identity,
  source partitioning, malformed-record rejection, long sparse history, bounded
  dense output, and absence of raw arrays/provider snapshots.
- Expected outcomes: defaults remain exact, every requested name has one policy,
  enabled resource lists round-trip exactly, unknown resources fail closed,
  sparse event counts match valid records, dense outputs stay under fixed
  ceilings, and no new persisted payload grows with upstream sample count.
- PR completion requires green exact-head required GitHub checks and zero
  unresolved findings from the applicable preliminary and final ReviewGPT
  passes.
Completed: 2026-08-12
