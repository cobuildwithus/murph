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

## Verification

- Commands to run: focused importer/use-case/CLI tests, affected package
  typechecks and coverage, `pnpm test:scenario-integrity`, a redacted inspection
  of the supplied export, PR CI, and both required ReviewGPT stages.
- Expected outcomes: 915 sessions are structurally recognized from the supplied
  export without row contents entering output; import blocks only on the
  explicit weight and distance unit choices; synthetic end-to-end import and
  replay are atomic and bounded; all required gates pass.
- Latest focused remediation proof: importer planner 24 tests and vault workout
  import 14 tests pass after round 3 remediation. Core event-batch 33 tests, CLI
  workout command coverage 8 tests,
  assistant guidance 3 tests, changelog 57 tests, scenario integrity (206
  scenarios / 12 sample inputs / 29 golden directories), all affected package
  typechecks, and affected package builds pass. The supplied export still plans
  7,521 rows into 915 sessions with 23 deterministic repairs, 23 ignored
  rest-timer rows, zero skipped rows, and explicit weight and distance unit
  gates; no import was performed. PR CI and final ReviewGPT remain pending.
