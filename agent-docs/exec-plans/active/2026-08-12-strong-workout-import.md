# Make Strong workout CSV import bounded, replay-safe, and token-efficient

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Let Murph inspect and bulk-import a Strong workout-history CSV through one
  bounded CLI surface without sending individual sets through the model,
  while preserving timezone, set-tag, raw-evidence, validation, and replay
  invariants.

## Success criteria

- Strong's current 12-column export shape is recognized, including quoted CSV,
  deterministic text-field comma recovery, `W`/`D`/`F` set tags, explicit
  rest-timer metadata omission, exercise notes, and timezone-less timestamps
  interpreted in the vault timezone.
- The whole structured batch is validated before raw persistence and committed
  through the canonical bulk event owner, so one bad session creates no partial
  workout history.
- Re-importing an unchanged export creates no new workout revisions or raw
  batch, and changed same-revision content fails closed.
- Missing weight or distance unit provenance is an explicit, actionable
  pre-write choice, including bodyweight, assistance, and added-weight loads;
  a confirmed prior unit mistake has an exact-evidence correction path.
- Explicit Strong or Hevy selection controls provider-specific note, set-type,
  and set-order semantics, including marker-free Hevy exports.
- File/session/row limits and bounded success output keep model context and
  local resource use predictable for multi-year exports.
- Synthetic focused tests, the real-file redacted inspection, typechecks,
  scenario integrity, PR CI, preliminary ReviewGPT specialists, and final
  ReviewGPT all pass on the exact pushed head.

## Scope

- In scope: Strong CSV parsing/planning, workout import orchestration, CLI
  contracts/discovery, assistant guidance, durable command docs, tests, and a
  member-visible changelog entry.
- Out of scope: changing Strong, continuous Strong sync, importing Strong body
  measurements, guessing unlabelled units, or adding a second workout storage
  model.

## Constraints

- Technical constraints: reuse `activity_session`, raw workout manifests, and
  `core.importEventBatch`; keep parser work in `packages/importers`; preserve
  one-way package dependencies; use aggregate warnings only.
- Product/process constraints: never persist the supplied private export or its
  row contents in the repository or review artifacts; use synthetic fixtures;
  keep outputs bounded; follow the PR and ReviewGPT completion lane.

## Risks and mitigations

1. Risk: naive Strong timestamps shift when the host timezone differs.
   Mitigation: resolve them with the canonical vault timezone and test under a
   deliberately different process timezone.
2. Risk: a malformed late row leaves hundreds of earlier events committed.
   Mitigation: parse and dry-run the complete event decision batch before raw
   persistence, then apply the canonical batch once.
3. Risk: replay duplicates history or floods model context with event ids.
   Mitigation: stable privacy-safe identities for new imports, exact-hash prior
   raw-evidence discovery, bounded lookup of the live events attached to that
   evidence, authoritative identity reuse, replay no-op handling, and capped
   identifier/path arrays.
4. Risk: Strong's unitless `Weight` and `Distance` columns are interpreted
   incorrectly. Mitigation: require explicit `--weight-unit` and
   `--distance-unit` values when positive values are present in any load or
   distance field, normalize explicit units, and require exact prior evidence
   plus `--correct-units` before superseding a mistaken unit choice.

## Tasks

1. Extract a bounded Strong-aware workout CSV planner into `packages/importers`.
2. Replace per-session writes with validate-first canonical batch import and
   replay-safe raw-evidence orchestration.
3. Tighten the CLI result/discovery contract and assistant guidance for the
   required unit choices and bounded output.
4. Add synthetic parser, use-case, and built CLI coverage plus durable docs and
   changelog.
5. Run focused proof, inspect the candidate, push/open the PR, run ReviewGPT
   specialists and final review concurrently with CI, remediate, and finish.

## Decisions

- Treat Strong's timezone-less date column as local to the vault, never to the
  machine running the CLI.
- Preserve raw evidence before the canonical apply, but do not store another
  raw batch for an unchanged replay identified by a full-batch dry run.
- Keep existing command names; harden the dormant path instead of adding a
  competing importer.
- Use a dated importer-mapping revision rather than treating a revisionless CSV
  as permanently fixed. Bump it only when a corrected mapping must supersede
  prior canonical output.
- New imports keep the privacy-safe timestamp hash. Before identity selection,
  find an exact prior workout manifest and verify its source artifact by byte
  length and SHA-256, then resolve the live events attached to that raw ref in
  one bounded core lookup. Keep those authoritative external references; never
  reconstruct a legacy identity from the current vault timezone.
- An explicit recognized Strong or Hevy source selects the parser dialect.
  Header inference applies only without that option, and an unambiguous
  provider-marker conflict blocks before any write.

## Review findings

- Final ReviewGPT round 1 found that the candidate would duplicate workouts
  previously written by the shipped importer. The remediation preserves the
  new private identity for new imports while resolving the legacy external
  reference in one batch and proving exact existing raw evidence before reuse.
- Final ReviewGPT round 1 also found that later-row session/exercise metadata,
  unit-bearing distance aliases, and session distance projection had regressed,
  and that a fixed epoch mapping revision prevented future parser corrections.
  The planner now accumulates first non-empty metadata across the session,
  restores the distance surfaces, and uses the explicit mapping revision above.
- Final ReviewGPT round 2 proved that reconstructing the legacy key with current
  vault-timezone rules still duplicated imports made under a different host
  timezone. The second remediation makes exact raw evidence and its attached
  live events authoritative, covers daylight-saving and repeated timezone
  changes, and fails closed on a partial or ambiguous attachment set.
- Final ReviewGPT round 2 also proved that a marker-free Hevy export explicitly
  labeled `hevy` still took Strong parsing branches. Explicit recognized source
  selection now controls note, set-type, and set-order semantics; the mapping
  revision was bumped so a prior incomplete Hevy mapping supersedes in place.
- The preliminary specialist pass found that unitless bodyweight, assistance,
  and added-weight columns could silently persist as kilograms. Those fields
  now share the explicit weight-unit gate, honor unit-bearing values and header
  suffixes, reject conflicts, and normalize pounds to canonical kilograms. It
  also requested a safe correction journey, which is now an explicit exact-raw
  `--correct-units` supersession instead of a destructive re-import.
- The preliminary specialist pass also found missing shared assistant guidance,
  direct ambiguous-comma coverage, and overstated scenario-manifest claims.
  Strong and Hevy now share one inspect-first workflow, the ambiguous repair is
  exercised fail-closed, and the scenario docs identify focused tests as the
  executable proof owner.
- Final ReviewGPT round 3 found that unit correction reparsed timestamps using
  the current vault preference. Correction now uses the exact evidence's
  original timezone and compares every non-unit session, exercise, and set field
  with the attached live records before allowing a supersession.
- Final ReviewGPT round 3 also found that source-omitted shared headers still
  guessed Strong. Shared Strong/Hevy shapes now require an explicit provider,
  while an exact prior batch mislabeled Strong can adopt explicit Hevy semantics
  in place through its existing raw attachment and authoritative event IDs.
- Final ReviewGPT round 4 found that correction rebuilt current events from a
  lossy CSV projection. Corrections now start from each latest attached event
  and patch only explicitly unit- or dialect-owned fields; later tags, activity
  classification, experiment context, evidence, attachments, workout media,
  route/metrics, routine fields, and other canonical context survive by
  construction. Overlapping exercise/set edits fail before mutation.
- Final ReviewGPT round 4 also found that shipped-importer compatibility covered
  only byte-identical files. The planner now emits a provider-neutral hashed
  source-session key, and the usecase boundedly replans verified prior raw
  snapshots and resolves their attached events in one core lookup. Refreshed
  exports skip overlapping sessions, create only new sessions, and fail closed
  on changed, partial, conflicting, ambiguous, or over-limit evidence.
- Final ReviewGPT round 5 found that raw-reference lookup returned only the
  latest live revision, so a member-deleted workout could be recreated by a
  later expanded snapshot and later title/time edits could break source-session
  identity. The core lookup now returns the immutable attachment revision plus
  the latest revision, including tombstones. Reconciliation maps with the
  attachment, preserves the latest live payload, and treats a tombstone as an
  authoritative skipped session rather than a request to recreate it.
- Final ReviewGPT round 5 also found that canonical end timestamps were excluded
  from refreshed-snapshot comparison and that raw-only storage bypassed the
  ambiguous-provider gate. The planner now compares a privacy-safe hash of the
  raw provider end input, and raw-only storage requires the same explicit or
  unambiguous Strong/Hevy recognition as structured import.
- Final ReviewGPT round 6 found that source identity still hashed timestamp
  spelling, so an accepted `10:00` to `10:00:00` formatting change could create
  duplicate workouts, while a genuine missing or changed prior start time was
  silently treated as new. Source-session keys now hash a canonical source
  wall-clock/offset representation independent of the vault timezone, and each
  admitted prior complete snapshot must be a subset of the refreshed snapshot
  before any new session is allowed.
- Final ReviewGPT round 6 also found that inspection returned raw header cells,
  allowing a headerless row or near-limit cell to enter assistant context.
  Public inspection output and its typed CLI contract no longer contain source
  headers. CLI proof uses sentinel row values and a near-limit single-cell file
  to keep output private and constant-sized.
- Final ReviewGPT round 7 found that exact-evidence correction could race a
  member edit or deletion between preview and apply, and that identical
  correction retries always minted another revision. Explicit batch decisions
  now carry an optional expected event ID and lifecycle revision; core validates
  every expectation under the canonical write lock before reconciling any row.
  Identical confirmed corrections return a no-op before minting a revision.
- Final ReviewGPT round 7 also found that source identity conflated a naive wall
  time with an explicit instant that happened to normalize to the same UTC
  spelling. Source start/end identities now tag their temporal domain while
  still canonicalizing equivalent wall-time spellings and equivalent explicit
  offsets, including midnight crossings.
- Final ReviewGPT round 7 also found that legacy manifests without unit fields
  were treated as compatible with every later unit choice. Compatibility now
  comes from the aligned latest canonical unit projection. A shipped unitless
  projection is accepted only as the exact correction ownership baseline, so
  the first explicit unit choice requires confirmation and writes the selected
  units without replacing member-owned fields.
- Final ReviewGPT round 8 found that a byte-different equivalent snapshot whose
  every prior session is tombstoned suppresses every workout decision, then
  crosses the generic core boundary as an invalid empty batch. The workout
  owner now recognizes that fully reconciled domain state before the core call
  and returns a successful aggregate no-op without raw, event, or audit writes.
- Final ReviewGPT round 8 also found that the required PR disclosure omitted the
  shared optimistic-concurrency surface introduced by round 7. The PR now names
  the optional event ID/lifecycle-revision fence, explains why core validates it
  under the canonical lock, and points to the generic and workout race proof.
- Final ReviewGPT round 9 found that arbitrary CSV header cells were still
  copied into immutable manifests and therefore exposed through the public
  manifest read. Workout manifests now retain only the bounded provenance
  required for reconciliation; raw headers remain solely in the private raw
  artifact. Sentinel coverage proves inspection, persisted manifests, and
  public manifest output omit both an arbitrary header and its value.
- Final ReviewGPT round 9 also found that replay and refreshed-snapshot checks
  treated the latest member-edited canonical load and distance values as source
  evidence. Exact replay now uses immutable manifest units when present,
  refreshed snapshots compare the verified old raw plan with the new raw plan,
  and latest events remain payload authority. Unit correction ownership is
  split by selected axis, so a load-only correction preserves an edited
  distance and a distance-only correction preserves an edited load; edits to
  the selected axis still fail closed.
- Final ReviewGPT round 10 found that provider-first recovery contradicted
  itself when the member also knew the stored units were wrong. Provider
  correction now always reuses exact manifest units for its narrow reparse, so
  the executable first step needs only the confirmed provider; the separate
  unit correction follows with the confirmed unit.
- Final ReviewGPT round 10 also found that the unit-correction structure fence
  rejected ordinary member context such as notes, reps, duration, RPE, and
  derived exercise mode. The fence now covers only exercise identity/order and
  set array order. Selected-axis projections still reject edited load or
  distance values, and expected-latest fences still reject concurrent changes.
- Final ReviewGPT round 11 found that the planner deliberately preserved
  sessions with missing, malformed, or over-range durations, but the canonical
  activity-session contract still required a duration and rejected the batch.
  Canonical structured workouts now allow an unknown duration, omit it without
  inventing a value, and retain every otherwise valid exercise and set through
  replay, unit correction, and refreshed-snapshot reconciliation.
- Final ReviewGPT round 11 also found that a structured import could attach to
  an exact raw-only batch whose unresolved unit provenance differed from the
  confirmed plan. An unattached raw-only batch is now reused only when provider,
  delimiter, timezone, weight unit, and distance unit all match exactly;
  otherwise the structured import stores and attaches a correctly provenanced
  immutable batch.
- Final ReviewGPT round 12 found that the unknown-duration exception had
  widened every structured workout writer. The exception is now an
  importer-only transient option; ordinary add, import-json, and saved-format
  logging continue to derive or require duration before any write.
- Final ReviewGPT round 12 also found that an expanded snapshot could use a
  newly confirmed unit to compare legacy raw evidence while retaining old
  unitless canonical loads, and that a provider-corrected tombstone kept its
  old source label and blocked later expansion. Legacy unitless overlap now
  requires its latest canonical projection to prove the selected units or an
  exact-original correction first. Deleted latest revisions are exempt from
  the live provider-payload check because their original attachment already
  proves identity and they remain suppressed.

## Verification

- Commands to run: focused importer/use-case/CLI tests, affected package
  typechecks and coverage, `pnpm test:scenario-integrity`, a redacted inspection
  of the supplied export, PR CI, and both required ReviewGPT stages.
- Expected outcomes: 915 sessions are structurally recognized from the supplied
  export without row contents entering output; import blocks only on the
  explicit weight and distance unit choices; synthetic end-to-end import and
  replay are atomic and bounded; all required gates pass.
- Latest focused remediation proof: importer planner 24 tests, vault workout
  import 15 tests, and CLI workout command coverage 8 tests pass after round 4
  remediation. Core event-batch 33 tests, assistant guidance 3 tests,
  changelog 57 tests, scenario integrity (206
  scenarios / 12 sample inputs / 29 golden directories), all affected package
  typechecks, and affected package builds pass. The supplied export still plans
  7,521 rows into 915 sessions with 23 deterministic repairs, 23 ignored
  rest-timer rows, zero skipped rows, and explicit weight and distance unit
  gates; no import was performed. PR CI and final ReviewGPT remain pending.
- Round 7 remediation proof: importer timestamp coverage (27 tests), focused
  workout import and public-loader coverage (21 tests), the full core package
  suite (784 tests), contracts artifact verification, all four affected package
  typechecks, diff checks, and the identifier/privacy scan pass. The correction
  tests prove identical retries leave event and audit revisions unchanged, an
  edit between preview and apply rejects without a correction write, edit and
  delete fences reject a two-event core batch atomically, and a legacy unitless
  Strong event requires and accepts an exact-evidence unit correction. Final
  ReviewGPT and exact-head PR CI remain pending.
- Round 8 reproduction and remediation proof: a production-runtime two-session
  import, deletion of both canonical workouts, and byte-different equivalent
  replay reproduced `EVENT_BATCH_EMPTY`. The retained regression now proves a
  successful two-session skipped no-op, unchanged raw and audit collections,
  unchanged event-ledger row count, and continued tombstone authority. Final
  focused verification, the next exact-head ReviewGPT pass, and PR CI remain
  pending.
- Round 9 remediation proof: focused workout-usecase coverage passes 18 tests,
  focused CLI workout coverage passes 9 tests, and the affected usecase and CLI
  typechecks pass. The tests prove private header omission through all public
  surfaces, exact replay after a member load edit, refreshed-snapshot expansion
  with that edit preserved, independent load and distance correction ownership,
  identical correction no-ops with an edited unselected axis, changed-unit
  expanded-snapshot rejection, and legacy unit-provenance migration.
- Round 10 remediation proof: production-runtime usecase coverage proves a
  provider correction can reuse the wrong stored unit without asking the
  member to repeat it, then a separate unit correction retains the same event,
  member context, and raw evidence before exact replay and snapshot expansion.
  Unit-correction coverage proves notes, reps, duration, RPE, and exercise mode
  survive, while a positional set-order edit and a selected-axis load edit both
  still fail closed.
- Round 11 remediation proof: contract parsing accepts structured activity
  sessions without a proven duration; production-runtime usecase coverage
  imports malformed, over-range, and missing-duration sessions with all sets,
  then preserves them through replay, correction, and expansion. A separate
  production-runtime test proves unresolved raw-only units create a new
  confirmed manifest and attachment, while exact matching provenance still
  reuses the original raw batch. Focused contracts (12), importer planner (27),
  workout usecase (20), and CLI (10) tests pass; contracts artifacts and the
  affected contracts, core, query, and vault-usecases typechecks pass.
- Round 12 remediation proof: production CLI and usecase coverage keeps the
  unknown-duration exception limited to CSV, rejects ordinary structured and
  saved-format writes before mutation, rejects direct expanded legacy
  weight-and-distance reinterpretation without storing raw or audit state,
  admits expansion after exact correction, and preserves provider-corrected
  live edits plus tombstones through expansion and replay.
