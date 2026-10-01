# Preserve typed batch failures and requested envelopes

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep safe protocol-artifact and native CLI validation failures typed when a
  child command runs through `vault-cli batch`, instead of demoting them to the
  generic `UNKNOWN` recovery envelope.
- Keep an explicitly requested child `--full-output` failure envelope available
  in compact mode while continuing to deduplicate direct typed error objects.

## Success criteria

- The closed public batch child-error stage schema accepts
  `protocol_family_graph`, `protocol_index`, and `protocol_run_specs` while
  continuing to reject unknown stage strings.
- Every proven CLI-specific projected stage is accounted for by the batch
  contract: `query_source` plus the three protocol artifact stages.
- Each protocol artifact failure retains its code, message, retryability, hint,
  and stage through both compact and noncompact batch execution.
- Native Incur validation envelopes retain `VALIDATION_ERROR`, safe field paths
  and issue codes, and `validation` stage while raw messages and received values
  are replaced with a bounded public shape.
- Compact mode clears only a direct typed JSON error. A nested child
  `--full-output` envelope remains in stdout so its `ok`, `meta`, and optional
  CTA data are not erased.
- Focused contract and CLI tests plus both touched package typechecks pass.

## Product UX

- Effort: Patch.
- Outcome: an agent receives actionable typed protocol and validation recovery
  even in a batch, without losing explicitly requested envelope metadata.
- Reaches: agents using batch for Commons protocol discovery, inspection, and
  exploration; agents correcting invalid food queries or event filters; agents
  consuming child full-output metadata; ordinary single-command recovery
  remains unchanged.
- Proof: a deterministic child boundary covers all three protocol stages in
  compact and noncompact execution; real food `too_big` and event enum
  validation failures retain safe typed recovery; and a real compact batch
  retains a requested nested failure envelope without exposing submitted values
  or a vault path.

## Scope and owner decision

- In scope: the operator-config-owned closed batch error contract and the
  existing CLI-owned batch child-error parse/deduplication boundary, with
  focused contract, boundary, and production-entrypoint regressions.
- Out of scope: changing the Health Commons projector, adding new stages,
  changing artifact loading, changing Incur, or redesigning the error envelope.
- The canonical Health Commons artifact union lives in the higher
  `@murphai/health-commons` package. Importing it into lower operator-config
  would add the wrong dependency, so this correction adds all three proven
  fixed public literals to the existing closed batch schema and guards the
  boundary with explicit regressions.

## Risks and mitigations

1. Risk: opening the schema to arbitrary internal stages.
   Mitigation: retain a closed enum and add only the three fixed stages already
   emitted by the safe CLI projector.
2. Risk: a schema-only test misses the child stdout parsing boundary.
   Mitigation: run every artifact stage through the batch command in compact and
   noncompact modes, and retain existing real Commons projector coverage.
3. Risk: loosening the public schema admits raw Incur validation messages or
   received values.
   Mitigation: recognize only `VALIDATION_ERROR`, whitelist paths, Zod issue
   codes, and primitive expectations, replace messages and received values with
   fixed safe values, cap issue count, and parse the projection through the
   unchanged closed schema.
4. Risk: compact deduplication erases explicitly requested child metadata.
   Mitigation: distinguish direct error objects from nested envelopes and retain
   the whole nested stdout payload, with real accounting and privacy assertions.

## Tasks

1. [completed] Add all proven protocol artifact stage literals to the closed
   batch child-error contract and prove unknown stages stay rejected.
2. [completed] Add compact and noncompact batch-boundary coverage for all three
   protocol artifact failures while retaining real owner-projection coverage.
3. [completed] Normalize native validation envelopes at the existing child-error
   boundary and cover short and over-bound production-shaped Incur failures.
4. [completed] Preserve requested nested full-output failure envelopes in
   compact mode and cover metadata, accounting, and privacy behavior.
5. [completed] Run focused owner tests and typechecks, replay the agent recovery
   walkthrough, and record the exact results.
6. [completed] Close the implementation plan and prepare the exact scoped
   commit inputs for PR follow-through.

## Verification

- `pnpm exec vitest run --config packages/operator-config/vitest.config.ts --no-coverage packages/operator-config/test/vault-cli-contracts.test.ts`
- `pnpm --dir packages/cli exec vitest run test/batch-protocol-error-stages.test.ts`
- `pnpm --dir packages/cli exec vitest run test/batch.test.ts`
- `pnpm --dir packages/cli exec vitest run test/vault-cli-error-projection.test.ts -t "recognizes only the fixed safe Health Commons artifact error shape"`
- `pnpm --dir packages/cli exec vitest run test/commons-command-coverage.test.ts -t "commons protocol commands fail closed when their artifacts are unavailable"`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/cli typecheck`
- `git diff --check`

## Results

- Operator-config contract suite: 6 passed.
- Protocol batch-boundary regression: 1 passed in compact and noncompact modes.
- Full batch suite: 15 passed, including direct compact validation
  deduplication and requested full-output envelope retention.
- Strengthened production-shaped validation regression after the full suite: 1
  passed with the short food `too_big` and long event enum cases.
- Existing real Commons artifact projector regression: 1 passed; existing real
  unavailable-artifact command regression: 1 passed.
- Operator-config and CLI package typechecks: passed.
- Generated CLI schema/type files remained stable; the derived CLI skill hash
  refreshed for the expanded batch output contract.
- Product UX replay: direct compact errors expose one bounded typed recovery
  object; noncompact errors retain source stdout; requested full-output errors
  retain their child envelope and metadata; protocol discovery failures retain
  their existing artifact-specific repair stage and hint.
- `git diff --check`: passed.
Completed: 2026-08-30
