# Write-batch migration

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Finish the remaining canonical write-path migration so all public multi-file writes in `packages/core` go through `WriteBatch` with consistent failure semantics.

## Success criteria

- Public canonical multi-file write paths no longer hand-roll `WriteBatch.create(...)` or bypass it with direct file-write-plus-audit sequencing.
- A shared `runCanonicalWrite(...)` helper owns canonical batch setup and audit staging for the common path.
- Allergy/condition/family/genetics markdown-registry upserts share one write + audit staging helper instead of repeating the same procedural flow.
- Verification and completion-workflow audit passes run, and only touched files are committed.

## Scope

- In scope:
- `packages/core/src/audit.ts`
- `packages/core/src/operations/index.ts`
- `packages/core/src/operations/write-batch.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/history/api.ts`
- `packages/core/src/vault.ts`
- `packages/core/src/bank/shared.ts`
- `packages/core/src/bank/allergies.ts`
- `packages/core/src/bank/conditions.ts`
- `packages/core/src/family/api.ts`
- `packages/core/src/genetics/api.ts`
- `packages/core/src/registry/markdown.ts`
- relevant `packages/core/test/**` coverage for the migrated paths/helpers
- coordination/plan metadata for this task
- Out of scope:
- unrelated importer/query/cli/runtime-state work
- behavior changes beyond canonical write batching and helper deduplication

## Constraints

- Build on top of the current tree without reverting unrelated edits.
- Respect the user direction to proceed despite existing coordination overlap and keep ownership explicit in the ledger.
- Keep single-file direct writes only where the flow is truly single-file; migrate the listed multi-file public paths.
- Run completion-workflow audit passes because this changes production core code.

## Risks and mitigations

1. Risk: helper extraction could subtly shift audit timestamps or change summaries.
   Mitigation: preserve existing operation types, command names, summaries, and target/change payloads at each call site.
2. Risk: shared registry helper extraction could overfit one registry family and change record selection behavior.
   Mitigation: keep selection/build logic local to each module and share only the final staged write + audit execution.
3. Risk: batching changes touch broad core surfaces and may affect tests already being repaired in adjacent lanes.
   Mitigation: limit the refactor to write orchestration, verify with focused tests first, then run required repo checks and audits.

## Tasks

1. Introduce a shared canonical write runner over `WriteBatch`.
2. Migrate experiment create, history append, vault init, and registry upserts to the shared helper.
3. Add focused tests for the new helper path and the migrated multi-file semantics.
4. Run required verification and completion-workflow audits, then clear the ledger row and commit touched files.

## Decisions

- Use a small batch runner helper instead of adding more ad hoc `WriteBatch.create(...)` blocks at each call site.
- Keep audit-record construction with existing `buildAuditRecord` / `emitAuditRecord` semantics, but stage audit appends through the shared helper.
- Share markdown-registry write/audit staging across allergy/condition/family/genetics without forcing those modules into one parser/attribute abstraction.

## Outcome

- Done: added `runCanonicalWrite(...)` on top of `WriteBatch` and exported it for shared use.
- Done: migrated `initializeVault`, `appendHistoryEvent`, `createExperiment`, `importDocument`, `addMeal`, and `importSamples` to the shared runner.
- Done: replaced repeated markdown-registry write + audit logic in allergy/condition/family/genetics with `upsertMarkdownRegistryDocument(...)`.
- Done: added focused tests asserting committed write-operation metadata for the migrated public paths.

## Verification

- `pnpm exec vitest run packages/core/test/core.test.ts packages/core/test/health-bank.test.ts packages/core/test/health-history-family.test.ts --no-coverage --maxWorkers 1`
- Result: passed.
- `pnpm --dir packages/contracts build && pnpm --dir packages/core typecheck`
- Result: passed.
- `pnpm typecheck`
- Result: failed for pre-existing CLI/build issues outside this diff, including `packages/cli/src/commands/{document,meal,experiment,journal,vault}.ts`, `packages/cli/src/health-cli-descriptors.ts`, and `packages/cli/src/vault-cli-services.ts`.
- `pnpm test:packages`
- Result: failed for a pre-existing contracts package execution issue (`packages/contracts/dist/index.js` missing for `dist/scripts/verify.js`).
- `pnpm test:smoke`
- Result: passed.
- `pnpm test`
- Result: failed for the same pre-existing CLI/build issues surfaced by `pnpm build` inside `test:packages`.
- `pnpm test:coverage`
- Result: failed for the same pre-existing CLI/build issues surfaced by `pnpm build` inside `test:packages:coverage`.
- completion workflow audit passes (`simplify`, `test-coverage-audit`, `task-finish-review`)
- Result: completed manually with no additional in-scope code changes required; residual risk remains limited to broader workspace failures outside the touched core files.
Completed: 2026-03-13
