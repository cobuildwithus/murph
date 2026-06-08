# Runtime Contract Source Deletion

## Goal

Land the contract deletion on top of PR61 by keeping demand `source` in web/Temporal demand while removing it from shared runtime-wake and workspace-invocation request models.

## Scope

- Remove `source` from `HostedRuntimeEnsureProcessingRequest`.
- Remove `source` from `HostedWorkspaceInvocationRequest`.
- Keep legacy wire tolerance by validating old `source` values and dropping them from parsed runtime request objects.
- Update focused contract/runtime tests, assistant-runtime parser tests, and Cloudflare expectations.

## Constraints

- Preserve `HostedRuntimeDemand.source`; web and Temporal demand still use it.
- Do not add a new compatibility abstraction or runtime behavior keyed by `source`.
- Keep parser compatibility fail-closed for unsupported legacy source values.
- Preserve unrelated working-tree edits.

## Verification Plan

- Passed: `pnpm --filter @murphai/hosted-execution test -- hosted-orchestration-control.test.ts hosted-runtime-control.test.ts`
- Passed: `pnpm --filter @murphai/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts`
- Passed: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:diff <scoped runtime-contract files>`
- Passed after coverage-write test addition: `pnpm --filter @murphai/hosted-execution test -- hosted-orchestration-control.test.ts hosted-runtime-control.test.ts`

## Completion

- Required audits completed: security/privacy review, coverage-write, deep-review, task-finish-review.
- Final commit should use `scripts/finish-task` for this plan.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
