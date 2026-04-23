# Land targeted hosted/CLI cleanup follow-ups across runtime, web, engine, execution contracts, and dead helpers

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the requested follow-up cleanups across hosted runtime/web helpers, assistant-engine model resolution, hosted-execution wake helpers, CLI list commands, and dead local helpers without changing intended runtime behavior.

## Success criteria

- Hosted runtime no longer writes the singular `details.vaultSyncImport` field while hosted web still reads the singular fallback until retention cleanup.
- Hosted ingress/web encryption code shares one private helper/factory while keeping both existing public module APIs intact and using one ownership term for ingress field AAD input.
- Assistant-engine resolves and validates execution-driver model specs through one private helper instead of duplicating normalization/error branches.
- Hosted-execution member-owned wake builders/parsers use one explicit internal ownership name at the builder/parser boundary while the wire contract remains `userId`.
- The `capture`, `measurement`, and `workout` `list` subcommands use `createCommonListCommand` and keep current behavior.
- The listed dead helpers are removed with no remaining in-repo references.
- Required verification and audit passes complete, or any unrelated pre-existing failures are documented.

## Scope

- In scope:
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `apps/web/src/lib/vault-sync/session-service.ts`
- `apps/web/src/lib/{hosted-ingress,hosted-web}/**`
- `packages/assistant-engine/src/model-harness.ts`
- `packages/hosted-execution/src/{builders,parsers}.ts`
- `packages/cli/src/commands/{capture,measurement,workout,command-factory-primitives}.ts`
- The explicitly listed dead-helper definition sites and directly coupled tests if needed
- Out of scope:
- Behavioral redesigns of hosted wake contracts, hosted encryption policy, CLI command shapes beyond the three targeted `list` paths, or unrelated dirty-tree work.

## Constraints

- Technical constraints:
- Preserve public APIs and wire fields; keep contract compatibility where the request explicitly calls for phased cleanup.
- Do not revert or absorb unrelated in-flight edits already present in the worktree.
- Product/process constraints:
- Follow repo plan/ledger workflow, run required verification, and run required `coverage-write` plus `task-finish-review` audit passes before handoff.
- Use `gpt-5.4` `xhigh` subagents for the implementation slices requested by the user.

## Risks and mitigations

1. Risk: Overlapping dirty-tree edits in shared files could make a scoped commit unsafe.
   Mitigation: Keep the write set narrow, stage only touched files if safe, and document any commit blocker explicitly if overlap remains.
2. Risk: Small refactors around encryption/model resolution could subtly change failure behavior.
   Mitigation: Preserve existing public entrypoints, reuse current error types/messages, and verify with scoped tests plus typecheck.
3. Risk: CLI factory migration could alter option defaults or normalization.
   Mitigation: Keep the command descriptions and option semantics identical and verify with CLI/package coverage lanes.

## Tasks

1. Remove the hosted runtime singular vault-sync-import write while keeping the hosted web reader fallback.
2. Extract a shared private hosted encryption helper and align hosted-ingress ownership naming with its AAD member id.
3. Centralize assistant-engine execution-driver model-spec validation in one private helper.
4. Standardize internal member ownership naming in hosted-execution builders/parsers while preserving wire `userId`.
5. Move the three CLI `list` subcommands onto `createCommonListCommand`.
6. Delete the listed dead helpers and clean up any direct fallout.
7. Run scoped verification, required audit passes, and commit if the shared tree allows a clean scoped commit.

## Decisions

- Use four implementation workers with disjoint ownership: hosted/web cleanup, assistant-engine model harness, CLI list-command migration, and dead-helper deletions.
- Keep the hosted web singular `vaultSyncImport` fallback for this pass to avoid coupling cleanup with retention/backfill timing.
- Keep the shared hosted encryption helper at `apps/web/src/lib/hosted-encryption-shared.ts` so neither public module depends on the other module's folder.
- Add one focused CLI regression test for the migrated list commands instead of waiting for a later generic coverage sweep.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/execution.ts apps/web/src/lib/vault-sync/session-service.ts apps/web/src/lib/hosted-ingress/encryption.ts apps/web/src/lib/hosted-web/encryption.ts apps/web/src/lib/hosted-web/encryption-shared.ts packages/assistant-engine/src/model-harness.ts packages/hosted-execution/src/builders.ts packages/hosted-execution/src/parsers.ts packages/cli/src/commands/capture.ts packages/cli/src/commands/measurement.ts packages/cli/src/commands/workout.ts packages/cli/src/commands/command-factory-primitives.ts packages/inboxd/src/connectors/linq/normalize.ts packages/inbox-services/src/inbox-app/runtime.ts packages/device-syncd/src/config/provider-manifests.ts packages/device-syncd/src/providers/whoop.ts packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/src/assistant/providers/openai-compatible.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `pnpm test:smoke`
- Expected outcomes:
- The targeted owner checks pass with no new type or test regressions from this cleanup set.
- Actual outcomes so far:
- `pnpm typecheck` failed for a credibly unrelated pre-existing `packages/inbox-services` export-resolution issue in `test/runtime-type-ownership.test.ts` (`@murphai/inbox-services` module resolution), outside the touched cleanup seams.
- `bash scripts/workspace-verify.sh test:diff ...` failed for a credibly unrelated pre-existing `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` expectation about `executeCodexPrompt`, after the touched owner typecheck phases passed.
- `pnpm test:smoke` passed.
- Focused checks passed:
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/model-harness-runtime.test.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-run-drain-coverage.test.ts --no-coverage`
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-wake-parsers.test.ts test/hosted-execution.test.ts test/hosted-execution-builders-hosted-email.test.ts --no-coverage`
- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/incur-smoke.test.ts test/workout-command-coverage.test.ts --no-coverage`
- `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/list-command-factory-coverage.test.ts --no-coverage`
- `pnpm --dir apps/web exec eslint src/lib/hosted-ingress/encryption.ts src/lib/hosted-web/encryption.ts src/lib/hosted-encryption-shared.ts`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/crypto.test.ts test/vault-sync-session-service.test.ts --no-coverage`
- `git diff --check -- [touched files]`
- Symbol search for the deleted helper names under `packages` / `apps` returned no matches.
- Required audit passes:
- `simplify` found one medium behavior regression and two low simplification opportunities; all three were addressed before the final focused reruns.
- `coverage-write` found no worthwhile additional test changes because the changed behavior is already pinned in focused tests and the owner-level `test:diff` lane remains blocked only by the unrelated `assistant-wrapper-exports` failure.
- `task-finish-review` found one low proof gap on the hosted vault-sync plural read path; a focused `apps/web/test/vault-sync-session-service.test.ts` case was added and rerun green.
- Commit/closure note:
- No scoped commit was created because `packages/inboxd/src/connectors/linq/normalize.ts` overlaps another active ledger row and the shared `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` file carries unrelated concurrent churn, so any plan-bearing commit/finish path would risk absorbing work outside this cleanup task.
