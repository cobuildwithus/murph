# Core write-policy unification

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Move direct writes and `WriteBatch` onto one shared vault write-policy layer so raw immutability, append-only restrictions, path validation, and same-content reuse stay behaviorally aligned.

## Success criteria

- Direct writes in `packages/core/src/fs.ts` and staged writes in `packages/core/src/operations/write-batch.ts` consume shared validators and shared low-level write helpers.
- Existing public APIs and error codes remain unchanged.
- `WriteBatch` rollback behavior stays intact.
- Tests cover direct-vs-batch parity for allowed and rejected write cases.

## Scope

- In scope:
- shared target-policy validation for text, raw, JSONL append, and delete flows
- shared immutable-existing-match handling and shared low-level apply helpers
- targeted parity and regression tests in `packages/core/test/core.test.ts`
- Out of scope:
- API redesign of `WriteBatch` or the direct write helpers
- changes to broader mutation flows beyond the wiring required to consume the shared layer

## Constraints

- Technical constraints:
- preserve current error codes and overall behavior
- preserve batch metadata/rollback semantics
- keep path-safety and vault-boundary checks centralized and consistent
- Process constraints:
- keep the coordination ledger current until the lane is finished
- run completion workflow audit passes plus the required repo checks before handoff

## Risks and mitigations

1. Risk: subtle message/code drift between direct and batch validation paths can slip in during consolidation.
   Mitigation: keep shared validators parameterized by operation-specific messages and assert parity in tests.
2. Risk: batch commit semantics can regress if shared helpers hide backup or reuse details.
   Mitigation: keep rollback metadata in `WriteBatch` while limiting shared helpers to target prep, reuse checks, and apply outcomes.
3. Risk: raw-manifest writes are a valid raw-tree exception for staged text writes.
   Mitigation: encode explicit policy allowances in the shared validator rather than relying on a single hard-coded rule.

## Tasks

1. Extract shared write-policy validation and apply helpers.
2. Rewire direct and batch write paths onto the shared helpers.
3. Add parity tests for direct vs batched behavior and keep rollback coverage intact.
4. Run simplify, coverage, and final review audit passes, then re-run required checks and commit the scoped files.

## Decisions

- Keep public write APIs separate while moving policy decisions and low-level write semantics behind a shared internal module.
- Parameterize validator error messages where the existing direct and staged APIs intentionally use different guidance text.
- Preserve `WriteBatch` action bookkeeping in `write-batch.ts`; shared helpers return outcomes instead of owning metadata persistence.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- all required commands pass after shared-policy extraction and parity tests land
Completed: 2026-03-17
