# Align memory ids and frontmatter with the shared contracts surface

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Restore the published `packages/contracts` memory surface so newly emitted memory record ids and persisted memory frontmatter match the package-wide canonical contracts.

## Success criteria

- New memory record ids emitted by `createMemoryRecordId()` match `mem_<ULID>`.
- Memory frontmatter renders with the shared canonical `docType` and `schemaVersion` values from `constants.ts`.
- Legacy persisted memory docs with hash ids and/or legacy frontmatter still parse on read.
- Contracts/core/docs verification and required audit passes are green, or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/contracts/src/{ids,memory,constants}.ts`
  - directly coupled contracts/core/docs tests
  - frozen contracts docs that mention the affected memory surface
- Out of scope:
  - broad memory-product redesign
  - non-memory id families
  - one-off migration tooling outside an explicit read-compatibility seam

## Constraints

- Technical constraints:
  - Keep the fix compatible with existing persisted memory docs.
  - Do not add new dependencies for ULID generation.
- Product/process constraints:
  - Keep the diff scoped to the memory contracts seam and directly coupled proof.
  - Preserve unrelated dirty-tree edits.

## Risks and mitigations

1. Risk: switching ids from deterministic hashes to ULIDs could silently break assumptions in existing tests or read paths.
   Mitigation: update direct tests, keep existing-record update flows by explicit `recordId`, and add legacy-read coverage for previously persisted hash ids.
2. Risk: changing frontmatter dialect could strand existing `bank/memory.md` files.
   Mitigation: parse both legacy and canonical frontmatter, but always render the canonical shared form on write.

## Tasks

1. Register the work in the coordination ledger.
2. Patch memory id generation to emit canonical `mem_<ULID>` ids.
3. Normalize memory frontmatter onto the shared constants with legacy read compatibility.
4. Update directly coupled contracts/core/docs tests.
5. Run scoped verification, required audits, and a scoped commit.

## Decisions

- Use read-side compatibility for legacy hash ids and legacy memory frontmatter instead of treating those legacy shapes as canonical outputs.
- Keep legacy hash-shaped ids writable only when they already exist in the parsed memory document; new explicit write ids must still be canonical `mem_<ULID>`.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/contracts/src/memory.ts packages/contracts/src/ids.ts packages/contracts/src/constants.ts packages/contracts/test/automation-memory-event-lifecycle.test.ts packages/contracts/test/ids.test.ts packages/contracts/test/memory-shares-coverage.test.ts packages/contracts/test/public-entrypoints.test.ts packages/core/test/memory.test.ts docs/contracts/03-command-surface.md docs/contracts/02-record-schemas.md`
  - `pnpm test:smoke`
- Expected outcomes:
  - contracts/core memory coverage stays green for the touched slice
  - docs/contracts command-surface coverage remains aligned
- Actual outcomes:
  - Focused green proof:
    - `pnpm exec vitest run --project contracts packages/contracts/test/ids.test.ts packages/contracts/test/memory-shares-coverage.test.ts packages/contracts/test/automation-memory-event-lifecycle.test.ts packages/contracts/test/public-entrypoints.test.ts`
    - `pnpm exec vitest run --project core packages/core/test/memory.test.ts`
  - `pnpm test:smoke` passed.
  - `pnpm typecheck` remained blocked by unrelated pre-existing typecheck failures outside this slice, including dirty `packages/contracts/test/vault-layout-validation.test.ts` expectations and other unrelated workspace files.
  - The scoped `test:diff` lane remained blocked by unrelated pre-existing typecheck failures outside this slice, including merge-conflict markers in `packages/contracts/src/automation.ts` and unrelated `packages/core/src/operations/write-batch.ts` type errors in the dirty checkout.
Completed: 2026-04-23
