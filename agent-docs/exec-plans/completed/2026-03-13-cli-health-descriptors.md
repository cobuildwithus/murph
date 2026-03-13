# CLI health descriptors

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Replace the repeated CLI health noun wiring in `packages/cli/src/vault-cli-services.ts` and the noun command wrappers with descriptor-driven generation while preserving existing runtime behavior, command names, payload shapes, and result contracts.

## Success criteria

- Health noun metadata lives in one descriptor table instead of parallel hard-coded switch/branch chains.
- `vault-cli-services.ts` derives health scaffold templates, runtime shape guard members, generic `show`/`list` dispatch, not-found messages, and unwired stubs from descriptors.
- Health noun command files reuse shared schema builders/helpers instead of repeating identical raw-object envelopes.
- Existing health CLI tests still pass, with added coverage for descriptor-driven generic routing where needed.

## Scope

- In scope:
- `packages/cli/src/vault-cli-services.ts`
- `packages/cli/src/commands/health-command-factory.ts`
- health noun command wrappers under `packages/cli/src/commands/`
- CLI runtime/health tests needed to prove behavior preservation
- Out of scope:
- changes to `packages/query/**` runtime behavior
- changes to `packages/cli/src/commands/intake.ts`
- changes to canonical payload contracts or user-visible command names

## Constraints

- Preserve the current payload-first health command surface.
- Keep `--cursor` accepted as a reserved compatibility option even if it remains inert.
- Do not alter non-health CLI commands or actively owned non-CLI files.
- Treat orphaned ledger rows for the same CLI files as stale because their referenced active plans are absent and the claimed files were clean before this lane started.

## Risks and mitigations

1. Risk: Descriptor indirection obscures special cases like profile/current and history-kind list routing.
   Mitigation: Model those as explicit descriptor hooks instead of forcing them through stringly fallbacks.
2. Risk: Command schema cleanup drifts output validation.
   Mitigation: Keep the same Zod result shapes and only centralize builders for identical envelopes.
3. Risk: Runtime guard generation misses a required callable member and breaks integration loading.
   Mitigation: Build the member lists from descriptors plus explicit non-health base members and cover routing in tests.

## Tasks

1. Introduce descriptor definitions for health nouns and id prefixes.
2. Refactor service/runtime wiring to consume descriptors.
3. Centralize shared health command result schema builders.
4. Update/add tests for preserved generic and noun-specific behavior.
5. Run completion workflow audits, required checks, and commit scoped files.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes:
  - `agent-docs/prompts/simplify.md`
  - `agent-docs/prompts/test-coverage-audit.md`
  - `agent-docs/prompts/task-finish-review.md`
Completed: 2026-03-13
