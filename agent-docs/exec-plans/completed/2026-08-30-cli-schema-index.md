# Keep agent schema discovery compact and format-correct

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Outcome: Agents can discover root and command-group schemas without receiving every descendant leaf schema, and repeated format or token flags behave predictably.
- Reaches: `vault-cli` root and group `--schema --format json` discovery requests, including fallback rendering and its supported token controls.
- Proof: Focused synthetic wrapper tests plus the real source CLI prove compact descriptor-only indexes, final format precedence, token count/pagination, and unchanged leaf-schema behavior.

## Success criteria

- Root and group JSON schema indexes contain only bounded child command descriptors; descendant `schema` and `examples` payloads are absent.
- The last pre-terminator `--json` / `--format` selection determines whether the JSON schema-index fallback applies.
- `--token-count`, `--token-limit`, and `--token-offset` apply to the compact fallback output instead of being silently discarded.
- Focused CLI tests and package typecheck pass.

## Scope

- In scope: the shared schema-index wrapper and focused regression coverage.
- Out of scope: LLMS lazy-loading, credential redaction, command-family validation, native Incur error envelopes, and unrelated CLI UX findings.

## Constraints

- Technical constraints: keep the existing leaf `--schema` path unchanged; reuse the package's existing `tokenx` dependency; do not add dependencies or another discovery owner.
- Product/process constraints: smallest Product UX Patch; synthetic tests only; no production/private data; parent agent owns commit, push, and PR creation.

## Risks and mitigations

1. Risk: Compacting the index could hide the command path agents need to choose the next request.
   Mitigation: Preserve each valid manifest command's full `name` and optional `description`, plus the existing leaf-schema note.
2. Risk: Reimplementing token rendering could drift from Incur semantics.
   Mitigation: Use the same `tokenx` functions and mirror Incur's offset/limit/truncation marker behavior in one small helper with focused tests.
3. Risk: The fallback could intercept a non-JSON final format after an earlier JSON flag.
   Mitigation: Parse flags in order, stop at `--`, and test both precedence directions.

## Tasks

1. Add compact schema-index projection and final-format parsing.
2. Preserve supported token controls when rendering the fallback index.
3. Add focused synthetic and real-CLI regressions for shape, size, precedence, pagination, and leaf passthrough.
4. Run focused tests and package typecheck; inspect the diff for privacy and scope.

## Decisions

- Use only `{name, description?}` for index entries. Arguments, options, output schemas, and examples remain available from the documented leaf `--schema` follow-up.
- Apply token controls to the compact rendered index after the unbounded internal LLMS manifest is parsed; forwarding them to the internal manifest request would truncate it before JSON parsing.
- The existing Frog entry for fresh task-worktree dependency linking covers the only setup friction encountered, so no duplicate entry was created.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/vault-cli-schema-index.test.ts`: 4 tests passed, including schema/help flag detection at the positional terminator.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/incur-smoke.test.ts -t 'root and group schema json requests return command indexes'`: 1 test passed, 69 skipped.
- `pnpm --filter @murphai/murph typecheck`: passed.
- Direct proof locked by tests: the real root index is below 100 KB, the real `goal` index is below 20 KB, all entries are descriptor-only, token count/offset/limit operate on the compact fallback result, and literal `--schema` / `--help` values after `--` do not change wrapper routing.

## Progress

- [x] Reproduced the multi-megabyte root/group index, stale-format interception, and ignored token flags on the current head.
- [x] Selected the existing schema-index owner and a dependency-free rendering approach.
- [x] Implemented compact projection and rendering fixes.
- [x] Added and ran focused proof.
- [x] Inspected the final diff for scope and privacy; implementation is ready for parent-agent review and commit ownership.
Completed: 2026-08-30
