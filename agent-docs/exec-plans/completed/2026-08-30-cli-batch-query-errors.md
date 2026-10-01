# Preserve typed query-source failures in batch results

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep a query-source failure raised by a child `vault-cli` command fully
  recoverable when that command runs through `vault-cli batch`: the batch
  result must retain the child's safe code, message, retryability, stage,
  hint, and field errors instead of replacing them with `UNKNOWN`.

## Success criteria

- The public batch child-error schema accepts the existing safe
  `query_source` stage emitted by the CLI projector.
- A real query-source failure crossing the batch boundary retains its typed
  recovery metadata and does not echo private source contents or an absolute
  vault path.
- Compact mode removes a parsed child error envelope from `stdout` only after
  lifting that same safe error into the structured result.
- Every batch result distinguishes requested, executed, succeeded, failed, and
  stopped-early work without changing the legacy executed `count` meaning.
- Focused CLI tests and typechecks for both touched package owners pass.

## Product UX

- Outcome: an agent can recover from a batch child failure using one compact
  result, without interpreting `UNKNOWN`, double-reading the same JSON error,
  or guessing whether `stopOnError` skipped later commands.
- Reaches: agents using `vault-cli batch`, including compact high-volume reads
  and stop-on-error mutation sequences; ordinary single-command behavior is
  unchanged.
- Proof: a malformed canonical source is exercised through the real batch
  entrypoint with compact and stop-on-error enabled; the result preserves safe
  field-level repair guidance, reports the complete execution summary, clears
  duplicate error stdout, omits the private source marker and absolute fixture
  path from the lifted failure, and leaves the source unchanged.

## Scope

- In scope: the shared batch result contract, the batch execution summary and
  compact child-error projection, and one direct regression covering the
  existing query-source projection.
- Out of scope: new error stages, changes to query parsing or repair guidance,
  batch execution semantics, or broader error-projection redesign.

## Constraints

- Technical constraints: reuse the existing projector and strict public error
  schema; widen only the missing fixed stage literal.
- Product/process constraints: preserve privacy-safe output and make no vault
  mutation beyond the synthetic test fixture.

## Risks and mitigations

1. Risk: widening the batch schema could admit arbitrary internal stages.
   Mitigation: add only the already-public `query_source` literal and retain
   the closed enum and strict object schema.
2. Risk: a schema-only test could miss the actual child-output lifting path.
   Mitigation: exercise a real malformed canonical source through
   `vault-cli batch` and assert both recovery fields and non-echo behavior.
3. Risk: compact mode could erase non-error output from an unusual failed
   child.
   Mitigation: clear stdout only when the child output both parses as JSON and
   validates as the same typed child error lifted into the result.

## Tasks

1. [completed] Align the batch child-error stage enum with the existing
   query-source projector.
2. [completed] Add direct batch-boundary regression coverage with private-marker
   non-echo proof.
3. [completed] Add truthful additive execution-summary fields and compact
   typed-error deduplication.
4. [completed] Run focused tests and touched-owner typechecks, then record
   proof and the one timing-only suite retry.

## Decisions

- Keep `murph.vault-cli.batch-result.v1`: the change accepts an existing public
  child-error stage and adds backward-compatible optional summary fields
  without replacing or changing the meaning of existing fields.
- Keep the new summary fields optional in the shared parser for compatibility
  with already-captured v1 results, while every current CLI execution emits
  all four fields.
- Preserve `count` as the legacy executed-command count and expose `executed`
  explicitly rather than silently changing that field's meaning.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/batch.test.ts`
  - `pnpm --dir packages/operator-config typecheck`
  - `pnpm --dir packages/cli typecheck`
  - `git diff --check`
- Expected outcomes: all commands pass; the batch result carries
  `query_source` and the existing field error without private fixture content
  or an absolute fixture path.
- Results:
  - Focused query-source batch regression: passed (1/1).
  - Full `batch.test.ts`: passed 13/13 before the final fail-closed compact
    guard; on the exact final candidate, 12/13 passed and the unrelated first
    success-path test hit its existing 60-second timeout under load. Its
    immediate isolated rerun passed (1/1) in 28.38 seconds.
  - `@murphai/operator-config` typecheck: passed.
  - `@murphai/murph` typecheck: passed on the exact final source candidate.
Completed: 2026-08-30
Completed: 2026-08-30
