# Improve vault CLI events and document error recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Restore the existing vault CLI promise that model callers receive bounded,
  value-free repair guidance for ordinary event, journal, document, intake, and
  export failures instead of generic codes or opaque validation messages.

## Success criteria

- Invalid event imports and edits expose safe failing field paths through the
  shared repair envelope while JSONL line-summary behavior remains intact.
- Document and intake file failures use stable codes, stages, hints, and
  retryability without echoing submitted paths or raw filesystem causes.
- Intake title and projection failures, journal identifiers/streams, malformed
  export manifests, and export filesystem failures are recoverable through
  field- or stage-specific envelopes.
- Built-CLI tests prove code, retryability, stage, hint, field errors, and
  non-echo behavior; focused package tests and typecheck pass.
- The active plan is archived and all task-owned changes are committed through
  `scripts/finish-task`.

## Scope

- In scope: owner-local error mapping and validation for event imports/edits,
  journal links, document/intake imports, intake projection, and export pack
  read/materialization paths; focused error-envelope tests.
- Out of scope: shared JSON input/transport changes, arbitrary error-context
  projection, logging submitted values or absolute paths, command topology,
  hosted runtime behavior, and unrelated vault commands.

## Constraints

- Technical constraints: reuse `VaultCliRepair`; keep repair fields bounded and
  value-free; preserve existing domain ownership and JSONL summaries; add no
  state, dependency, or compatibility layer.
- Product/process constraints: Product UX Patch. Outcome: Murph can correct an
  ordinary CLI input or filesystem state on the next attempt. Reaches: model
  callers importing/editing records or managing export packs. Proof: final
  built-CLI envelopes for malformed input, missing/wrong-kind files, invalid
  journal values, corrupt manifests, and write failures, including explicit
  non-echo assertions.

## Risks and mitigations

1. Risk: validation details could echo health content or local paths.
   Mitigation: convert only issue paths/codes and authored value-free messages;
   assert submitted values, raw causes, and absolute paths are absent.
2. Risk: broad filesystem classification could hide the operation that failed.
   Mitigation: map errors at the owning import/export boundary with explicit
   stage and command-specific hints.
3. Risk: journal admission could reject previously accepted aliases.
   Mitigation: derive schemas from the canonical event-id and sample-stream
   owners and cover supported values plus invalid envelopes.

## Tasks

1. Trace foundation repair APIs and each scoped producer/test owner.
2. Add the smallest owner-local event, import, intake, journal, and export
   mappings or admission checks.
3. Add focused source and built-CLI envelope/non-echo/retryability tests.
4. Run focused tests, package typechecks, final diff/privacy inspection, and
   Product UX walkthrough.
5. Archive the plan and commit the scoped change with `scripts/finish-task`.

## Decisions

- Keep durable logging out of this slice: the model-facing envelope is the
  recovery owner, while recording submitted content or paths would increase
  privacy risk without improving repair.
- Reuse the foundation repair contract; do not serialize `context`, causes, or
  provider/filesystem objects.
- Preserve journal whitespace normalization while deriving admission rules
  from the canonical event-id pattern and sample-stream constants; invalid
  values now fail at their exact option index.
- Keep native framework validation retryability omitted rather than inventing
  a value in owner code; mapped domain and filesystem failures remain explicit.

## Verification

- Passed: built recovery scenarios (5 tests), event JSONL regressions (10),
  export/intake and manifest helper regressions (13), targeted journal mutation
  regression (1), vault-usecase helpers (6), importer tests (28), and package
  typechecks for CLI, importers, and vault-usecases.
- The full 42-test experiment/journal phase-two file was also sampled: 31 tests
  passed; ten experiment tests could not load the ignored generated Health
  Commons protocol artifact in this fresh worktree, and the journal regression
  exposed then verified the preserved whitespace behavior through its focused
  rerun.
- Final expectations proved: stable non-generic codes, bounded repair
  fields/hints, explicit retryability for mapped errors, no submitted values or
  absolute paths in final envelopes, preserved event JSONL behavior, and green
  valid journal/import/export journeys.
Completed: 2026-08-24
