# Checkpoint reason split

## Goal

Split hosted workspace checkpoint reasons by state class so normal runtime paths stop using broad `maintenance` full snapshots, while bootstrap and canonical workspace mutations still checkpoint through explicit full/base reasons.

## Success criteria

- Ordinary system mailbox receipt/provider-cleanup/dirty-ack state checkpoints are hot-state eligible.
- Activation/bootstrap system mailbox work uses an explicit full/base checkpoint reason when non-hot bootstrap state changes.
- Generic assistant/device-sync runtime progress uses an explicit full/base reason for possible canonical or non-hot workspace changes.
- The assistant runtime no longer emits `maintenance` as the default checkpoint reason.
- Dead hot-state incomplete fallback handling is removed if static evidence confirms no throw path remains.
- Focused contract/runtime/Cloudflare tests cover the new reason mapping.

## Scope

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `apps/cloudflare/test/hosted-local-snapshot-stress-e2e.test.ts`
- `agent-docs/references/hosted-runtime-protocol.md`
- `ARCHITECTURE.md`

## Constraints

- Preserve unrelated dirty worktree edits and active ledger rows.
- Keep old checkpoint reasons parseable unless a compatibility-safe hard cut is explicitly justified.
- Do not rely on idle shutdown as the commit boundary for canonical/non-hot workspace changes.
- Keep hot-state checkpoints limited to currently included assistant runtime paths.

## Plan

1. Register this active plan in the coordination ledger.
2. Add explicit checkpoint reasons for bootstrap, canonical runtime commits, and hot assistant runtime commits.
3. Route system mailbox and assistant phase checkpoint results by the state class that changed.
4. Update Cloudflare snapshot policy and tests so only explicit full/base reasons map to full.
5. Remove the dead hot-state incomplete fallback branch if confirmed by compile/tests.
6. Update durable architecture/protocol docs.
7. Run focused tests, typecheck/diff checks, and required completion audits.
8. Close the plan with the appropriate scoped commit, unless overlapping dirty work blocks it.

## Verification

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage runtime-bridge-workspace.test.ts`
- PASS: `pnpm --dir packages/hosted-execution exec vitest run test/hosted-runtime-control.test.ts`
- PASS: `pnpm --dir packages/hosted-execution typecheck`
- PASS: `pnpm --dir packages/runtime-state typecheck`
- PASS: `pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
- PASS: `pnpm --dir packages/assistant-runtime typecheck` after final-review fixes.
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` after final-review fixes.
- PASS: `rg -n "HostedAssistantRuntimeHotStateIncompleteError|continuity_incomplete" packages apps scripts agent-docs --glob '!**/dist/**' --glob '!**/.next/**'` returns no matches.
- PASS: `git diff --check` on scoped task files.
- BLOCKED: `pnpm typecheck` fails in `apps/cloudflare/test/user-runner-alarm.test.ts` with duplicate block-scoped `invoke` declarations from an unrelated idle-shutdown checkpoint lane.
- BLOCKED: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md` passes through the touched package/app owner typechecks and assistant-runtime package tests, then fails in reverse-dependent `packages/cli/test/setup-cli.test.ts` because an unrelated setup-wizard expectation lacks `modelProvider: null`.
- BLOCKED: `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts --no-coverage hosted-local-snapshot-stress-e2e.test.ts` reaches hosted-local setup and database reset, then fails before the test body while assembling the runner bundle because unrelated `packages/operator-config/src/hosted-assistant-config.ts` build code passes `string | undefined` where `string` is required.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
