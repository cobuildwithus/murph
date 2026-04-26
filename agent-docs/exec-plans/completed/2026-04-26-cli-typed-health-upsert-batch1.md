# CLI Typed Health Upsert Batch 1

## Goal

Add agent-friendly typed CLI command surfaces for the first batch of remaining JSON-only health entity upserts:

- `goal`
- `condition`
- `allergy`
- `family`
- `genetics`

Success means agents can create/update these records through typed incur arguments/options instead of an untyped stdin JSON blob, while preserving existing JSON fallback behavior unless a command has a complete typed replacement and tests prove parity.

## Constraints

- Follow incur's canonical typed-command model: real positional arguments/options with Zod-backed schemas, not stdin JSON as the primary agent command surface.
- Preserve unrelated dirty-tree work.
- Avoid changing health record schemas unless a directly required validation gap is found.
- Do not remove legacy JSON/import commands unless a same-change typed surface covers the same practical workflow and command metadata stays clear for agents.
- Health data write surfaces require security/privacy review before handoff.

## Scope

Primary files are expected under:

- `packages/cli/src/commands/**`
- `packages/cli/test/**`
- `packages/vault-usecases/src/**`
- directly coupled generated incur artifacts

Do not widen into Health Commons content, hosted runtime work, or unrelated CLI command families.

## Plan

1. Inspect the generic health command registration path and identify the least-conflicting extension point for typed save/upsert-style commands.
2. Run five implementation workers, one per entity, with disjoint command intent and explicit preservation of unrelated work.
3. Integrate the returned patches into one consistent command pattern.
4. Regenerate incur artifacts and run focused CLI/vault-usecases verification.
5. Run required security/privacy, coverage, and completion reviews.
6. Close this plan with a scoped commit if the current dirty tree allows it; otherwise archive the plan and report the commit blocker.

## Verification Targets

- Focused CLI tests for the five typed command surfaces.
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/vault-usecases typecheck` if vault-usecases surfaces change.
- Regenerated incur artifacts are diff-clean with the command definitions.
- Broader repo checks only where truthful and not blocked by unrelated active work.

## State

Created 2026-04-26. Batch-one implementation is locally integrated and focused tests pass. Full CLI typecheck, generated incur artifacts, and the full typed-agent schema guard remain blocked by the active regimen/protocol hard-cut drift in this shared checkout.

Completed:

- Added typed `save` command surfaces for `goal`, `condition`, `allergy`, `family`, and `genetics`.
- Preserved the generic health `upsert --input` JSON fallback commands.
- Aligned `condition save` with the active hard-cut model by exposing `--related-regimen-id`.
- Tightened `family save --related-variant-id` validation to require `var_<ULID>` and added no-write regression coverage.
- Collapsed typed health save manifest registration into one table to reduce drift.

Verification:

- `pnpm --dir packages/cli exec vitest run test/health-goal-save.test.ts test/health-condition-save.test.ts test/health-allergy-save.test.ts test/health-family-save.test.ts test/health-genetics-save.test.ts --config vitest.workspace.ts --no-coverage` passed, 5 files / 16 tests.
- Scoped `git diff --check` passed for the batch files.
- Scoped privacy/local-identifier scan over the batch files found no matches.
- `pnpm --dir packages/cli exec vitest run test/cli-typed-agent-inputs-schema.test.ts --config vitest.workspace.ts --no-coverage` is blocked by the active hard-cut's legacy protocol command import state (`PROTOCOL_KINDS` undefined during `src/commands/protocol.ts` load; earlier run also hit missing `packages/query/src/regimens.ts`).
- `pnpm --dir packages/cli typecheck` is blocked by active protocol/regimen and stale source/dist drift outside this batch.
- Incur artifact generation is blocked by the same active hard-cut/build errors.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
