# Incur payload-schema command surface

Status: completed
Created: 2026-06-17
Updated: 2026-06-17

## Goal

- Land the first concrete Murph payload-schema command surface for Incur-backed
  file payloads, keeping Incur `--schema` scoped to command args/options/env/output
  while exposing exact JSON/JSONL body contracts through first-class commands.

## Success criteria

- `vault-cli condition payload-schema --format json` emits the exact condition import payload schema.
- `vault-cli blood-test payload-schema --format json` emits a nested blood-test import payload schema that includes result/reference-range rules.
- `vault-cli encounter payload-schema --format json` emits the encounter bundle payload schema that mirrors the current encounter import normalizer contract without changing parser behavior.
- `vault-cli event payload-schema --for import-jsonl --kind <public-kind> --format json` emits a per-line JSONL row schema for public writable event kinds and rejects explicit ids.
- File-backed import/scaffold LLMS hints point agents to payload-schema for exact writable contracts and scaffold for examples.
- The implementation uses shared Zod schemas for validation and emitted JSON Schema; no hand-written duplicate schema docs.
- Existing `import-json`, `import-jsonl`, and scaffold commands remain backward compatible.
- Generated CLI/schema artifacts are updated where command topology changes require them.
- Focused tests cover command output, schema/scaffold compatibility, invalid nested payloads, event JSONL id rejection, and LLMS discovery copy.

## Scope

- In scope:
  - Shared payload-schema output envelope and CLI command factory/helper.
  - Condition, blood-test, encounter, and event JSONL payload-schema commands.
  - Contract/usecase schema ownership needed to ensure emitted schemas match validation.
  - Incur generated command metadata and command-surface/invariant docs updates.
  - Focused CLI/usecase/contract tests.
- Out of scope:
  - Replacing `import-json --input @file.json|-`.
  - Renaming existing commands or changing `event import-jsonl` from a leaf into a command group.
  - Global `vault-cli schema <command...>` resolver.
  - Broad event import-json schema coverage for every non-JSONL write path beyond the selected first tranche.
  - Any hosted/web/device-sync behavior.

## Constraints

- Technical constraints:
  - Preserve Incur `--schema` semantics: it must still describe only the command invocation and output.
  - Model new discovery with real Incur commands; no argv rewrites or synthetic nested action args.
  - Keep canonical writes delegated through core/usecase seams; CLI must not write vault files.
  - Avoid broad new abstractions. Add only the small shared helper needed to remove repeated command boilerplate.
  - Do not expose raw sample payloads, fixture PHI, local paths, or identifiers in tests/docs.
- Product/process constraints:
  - Favor simple agent ergonomics: exact contract from payload-schema, starter example from scaffold.
  - Maintain current operator compatibility and command names.
  - Work on branch `codex/incur-payload-schema` in the separate `murph-incur-payload-schema` worktree.
  - Preserve unrelated active lanes and do not touch files owned by unrelated ledger rows.

## Risks and mitigations

1. Risk: Emitted JSON Schema diverges from runtime validation.
   Mitigation: Make import validation and payload-schema output share the same Zod schema, and add tests that validate scaffold/sample payloads through the same schema.
2. Risk: Event payload-schema grammar fights the existing `event import-jsonl` leaf command.
   Mitigation: Use `event payload-schema --for import-jsonl --kind <kind>` rather than `event import-jsonl payload-schema`.
3. Risk: Exact encounter schema migration changes accepted payload behavior unexpectedly.
   Mitigation: Start by encoding the current normalizer behavior, keep current tests green, and add compatibility-focused schema tests.
4. Risk: Parallel workers create overlapping edits.
   Mitigation: First subagent batch is read-only/specification. Later write-capable workers get disjoint ownership lanes and must report changed paths.
5. Risk: Schema artifacts or generated CLI metadata drift.
   Mitigation: Regenerate using repo scripts and include artifact checks in verification.

## Tasks

1. Create isolated worktree and register the plan/ledger row.
2. Run parallel discovery subagents:
   - Contracts/schema agent: inspect reusable Zod schemas, generated JSON Schema path, and exact schema ownership for condition/blood-test/event row shapes.
   - Encounter agent: map current encounter import validation into a Zod schema plan without behavioral drift.
   - CLI/discovery agent: map Incur command registration, generated metadata, LLMS hints, and tests affected by adding sibling `payload-schema` commands.
3. Integrate discovery into a concise implementation spec in this plan before code edits beyond plan/ledger.
4. Implement shared payload-schema envelope/helper and condition/blood-test/event/encounter schemas.
5. Register payload-schema commands and update LLMS/scaffold hints.
6. Regenerate command/schema artifacts.
7. Add focused tests for schema output, validation sharing, event JSONL row constraints, and discovery copy.
8. Update durable command/invariant docs to reflect payload-schema as the exact contract path.
9. Run required verification and completion audit subagents.
10. Resolve accepted audit findings, rerun checks, close the plan, commit, push, and prepare PR handoff if requested.

## Parallel subagent batches

- Batch A: read-only discovery, launched immediately after plan registration.
  - Agent A1 owns contracts/schema questions; no edits.
  - Agent A2 owns encounter validation/schema extraction questions; no edits.
  - Agent A3 owns CLI command/discovery/tests questions; no edits.
- Batch B: write-capable implementation only if Batch A reveals clean disjoint lanes.
  - Worker B1 may own `packages/contracts/src/**`, generated schema artifacts, and contract tests.
  - Worker B2 may own encounter usecase schema/test changes.
  - Parent agent owns CLI integration, generated Incur metadata, docs, final integration, and conflict resolution.
  - If the lanes are not disjoint after Batch A, the parent agent will implement sequentially instead of forcing parallel writes.
- Batch C: completion audits after implementation is stable.
  - `coverage-write` because verification will include package/diff coverage.
  - `security-privacy-review` because the work changes health-data payload contracts and agent-visible generation surfaces.
  - `deep-review` because the change spans contracts, vault-usecases, CLI command topology, generated artifacts, and health-data import behavior.

## Decisions

- Keep the canonical user-facing spelling as `payload-schema`.
- Use `event payload-schema --for import-jsonl --kind <kind>` instead of `event import-jsonl payload-schema` to avoid colliding with the existing leaf command.
- Do not add the migration guide to `agent-docs/index.md`; that index intentionally excludes migration guides. Update durable contracts/invariants instead.
- Use real Incur command registration for all new discovery surfaces.
- Put reusable public payload contracts in `packages/contracts` when they can match runtime behavior without broadening ownership: condition, blood-test, and event JSONL row schemas.
- Keep encounter's payload schema in `packages/vault-usecases` because the current importer intentionally accepts loose measurement metric text and normalizes it before core validation.
- Keep `externalRef` optional in event JSONL row schemas because current import behavior allows append-only rows without external identity; schema descriptions should recommend it without changing runtime compatibility.

## Discovery integration

- Condition import currently validates through `conditionUpsertPatchPayloadSchema`; expose that as the condition import payload contract.
- Blood-test lacks a top-level import payload schema; add one that composes the existing blood-test result/reference-range contracts and validate `blood-test import-json` through it before calling core.
- Event JSONL rows are writable drafts, not stored event records. Do not derive them from `eventRecordSchema`; add per-kind row schemas that reject explicit `id`/`eventId` and share the same public writable kind list used by core.
- Encounter already has `encounterBundlePayloadSchema`; expose it through `encounter payload-schema` and avoid changing parser error behavior in this tranche.
- Add a small CLI payload-schema envelope helper so command outputs are consistent while Incur `--schema` continues to describe command args/options/output only.
- Update command hints, LLMS manifest metadata, and schema-index copy so agents learn: `payload-schema` is exact, scaffold is an example.

## Verification

- Commands to run:
  - Focused source/runtime checks while iterating, including direct CLI `--schema`/`payload-schema` probes.
  - `pnpm typecheck`
  - `pnpm test:diff <changed paths>`
  - Package coverage lane if `test:diff` is not truthful for touched owners: likely `pnpm --dir packages/cli verify:coverage`, `pnpm --dir packages/vault-usecases test:coverage`, and/or `pnpm --dir packages/contracts test:coverage` depending on final diff.
  - `pnpm test:smoke` if `packages/contracts`, `packages/vault-usecases`, or `packages/cli` runtime contract changes land.
- Expected outcomes:
  - New payload-schema commands return stable JSON envelopes and exact JSON Schema.
  - Existing file-backed import commands continue accepting supported payloads.
  - Generated artifacts are consistent with source.
  - Completion audit findings are fixed or explicitly rejected with evidence.

## Verification evidence

- `pnpm --dir packages/contracts generate` passed and regenerated 28 schema artifacts.
- Focused contracts tests passed:
  `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts test/payload-schemas.test.ts test/schema-catalog-examples.test.ts --no-coverage`.
- Focused CLI tests passed:
  `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/payload-schema-command.test.ts --no-coverage`.
- Focused post-audit regression tests passed:
  - `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts test/payload-schemas.test.ts test/schema-catalog-examples.test.ts --no-coverage`
  - `pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts test/encounter.test.ts --no-coverage`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/payload-schema-command.test.ts test/health-blood-test-save.test.ts --no-coverage`
- Package-local typechecks passed for `packages/contracts`, `packages/vault-usecases`, `packages/core`, and `packages/cli`.
- `pnpm build:workspace:incremental` passed.
- Built CLI probes passed for:
  - `blood-test payload-schema --format json`
  - `event payload-schema --for import-jsonl --kind symptom --format json`
  - `event payload-schema --schema --format json`
  - `condition payload-schema --format json`
  - `goal import-json --help` not advertising nonexistent `goal payload-schema`
  - `condition import-json --help` advertising `condition payload-schema`
- `pnpm typecheck` passed after final code changes.
- `bash scripts/workspace-verify.sh test:diff <task changed paths>` passed, including CLI targeted verification, affected package tests, Cloudflare verify, and hosted web verify; reran after the final event note-row schema correction.
- `pnpm test:smoke` passed.
- `git diff --check` passed.

## Completion audit outcomes

- Coverage-write found a discovery proof gap and added CLI tests proving `payload-schema` is advertised only for `condition`, `blood-test`, `encounter`, and `event`, not unsupported health nouns.
- Security/privacy review found no medium-or-higher findings.
- Deep review found two accepted findings:
  - `blood-test import-json` initially lost the existing `valueText` typo guidance; fixed with a pre-parse alias check that preserves the old diagnostic.
  - Payload schemas initially accepted invalid timestamp strings; fixed by using strict ISO date-time schemas for blood-test/event JSONL rows and the encounter payload-schema contract, with negative tests.
Completed: 2026-06-17
