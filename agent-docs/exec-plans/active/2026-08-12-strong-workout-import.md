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
  pre-write choice.
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
   Mitigation: stable privacy-safe external identities, equal-version semantic
   reconciliation, replay no-op handling, and capped identifier/path arrays.
4. Risk: Strong's unitless `Weight` and `Distance` columns are interpreted
   incorrectly. Mitigation: require explicit `--weight-unit` and
   `--distance-unit` values when positive values are present.

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

## Verification

- Commands to run: focused importer/use-case/CLI tests, affected package
  typechecks and coverage, `pnpm test:scenario-integrity`, a redacted inspection
  of the supplied export, PR CI, and both required ReviewGPT stages.
- Expected outcomes: 915 sessions are structurally recognized from the supplied
  export without row contents entering output; import blocks only on the
  explicit weight and distance unit choices; synthetic end-to-end import and
  replay are atomic and bounded; all required gates pass.
