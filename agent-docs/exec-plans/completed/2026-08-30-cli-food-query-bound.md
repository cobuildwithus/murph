# Reject overlong food label queries locally

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reject food label search queries that exceed the hosted provider's existing
  256-character boundary before any request is attempted, with structured,
  privacy-safe CLI validation that an agent can repair directly.

## Success criteria

- `food search-labels` exposes `maxLength: 256` in its generated command schema.
- A trimmed query of 256 characters still reaches the hosted data API.
- A query of 257 characters fails locally with the `query` field and `too_big`
  validation code, without calling fetch or echoing the submitted query.
- The food single-label client schema enforces the same provider boundary.
- Batch help accurately describes the identifier lookup already supported by
  the shared route.

## Scope

- In scope:
  - The food single-label query schema.
  - The `food search-labels` positional argument schema.
  - Focused food label CLI tests and the mechanically proven batch help text.
- Out of scope:
  - Hosted Web search implementation or latency behavior.
  - Food save/import/edit semantics.
  - Supplement label-search behavior or shared generic client validation.
  - New provider retries, logging, or telemetry.
  - Other CLI-family UX changes.

## Constraints

- Technical constraints:
  - Match the server's current trim-then-256-character contract exactly.
  - Keep the server unchanged and perform no provider request on invalid input.
  - Preserve privacy-safe machine errors without submitted-query echoes.
- Product/process constraints:
  - Product UX Patch: valid searches are unchanged; recovery becomes local and
    actionable for overlong input.
  - Work only in the assigned food-family worktree; commit and open the draft
    PR only after the candidate is explicitly accepted for delivery.

## Risks and mitigations

1. Risk: Client and command schemas drift or apply the bound before trimming.
   Mitigation: Reuse one exported limit and test whitespace plus exact 256/257
   boundaries.
2. Risk: Validation output leaks the submitted food query.
   Mitigation: Assert the final serialized envelope contains neither the
   private sentinel nor its value, and assert the safe field/code pair.
3. Risk: Help promises batch identifier support that the route does not own.
   Mitigation: Limit the copy correction to behavior mechanically proven by
   the shared per-query ID/UPC resolver.

## Tasks

1. Align food single-query and food command schemas with the 256-character
   hosted provider boundary.
2. Correct the food batch hint to describe its existing ID/UPC support.
3. Add focused exact-boundary, no-fetch, privacy, and schema tests.
4. Run focused tests, CLI typecheck, diff checks, and privacy inspection.

## Decisions

- Override the inherited query field at the food schema boundary so the food
  family matches its provider route without changing supplement behavior.
- Keep the server as the external authority; this change only mirrors its
  already-shipped boundary earlier in the CLI flow.

## Verification

- Commands to run:
  - Focused Vitest files covering food label service and command behavior.
  - CLI package typecheck.
  - Generated command schema inspection.
  - `git diff --check`, scoped diff review, and identifier/credential scan.
- Expected outcomes:
  - All focused checks pass; invalid input performs zero fetches and emits no
    submitted query; no unrelated files change.

## Outcome

- `food search-labels` now trims first and rejects queries over 256 characters
  at both the Incur command boundary and the food-owned client schema.
- A rejected query never reaches fetch and its submitted text is absent from
  the machine error; the envelope identifies `query` with `too_big` instead.
- Exact-boundary queries still reach the hosted route, and emitted command
  schema now advertises `maxLength: 256` to agents before invocation.
- Batch help now accurately states that each existing query may be ordinary
  search text, a USDA FDC id, or a UPC.
- The repository-owned config schema and Vault CLI skill hash were regenerated
  so packaged discovery surfaces match the changed food help contract.

## Reaches

- Production code is limited to `packages/cli/src/commands/food.ts` and
  `packages/cli/src/food-labels.ts`.
- Regression proof is limited to the existing food label, food command parity,
  and Incur smoke test files.
- Generated changes are limited to the config schema entry for food batch
  query guidance and the matching Vault CLI skill hash.
- No supplement schema, generic hosted-label client, Web route, command
  topology, persisted data, or provider behavior changed.

## Proof

- `pnpm exec vitest run packages/cli/test/food-labels.test.ts packages/cli/test/food-save-typed-parity.test.ts`
  passed: 2 files, 47 tests.
- `pnpm exec vitest run packages/cli/test/incur-smoke.test.ts -t 'food search-labels'`
  passed: 2 focused tests, 68 skipped.
- `pnpm --filter @murphai/murph typecheck` passed.
- `git diff --check` passed.

## Progress

- 2026-08-30: Confirmed the hosted route already trims and rejects queries over
  256 characters while single food search had no matching local bound.
- 2026-08-30: Scoped validation to the food-owned schema so supplement behavior
  remains unchanged.
- 2026-08-30: Added zero-fetch/non-echo, exact-boundary, schema, and batch-help
  regressions.
- 2026-08-30: Passed focused tests, CLI typecheck, and diff checks; candidate is
  ready for the delivery gates.
- 2026-08-30: Candidate was accepted for delivery; refreshed the emitted CLI
  config schema and matching skill hash, then proceeded to the scoped commit
  and draft PR.
Completed: 2026-08-30
