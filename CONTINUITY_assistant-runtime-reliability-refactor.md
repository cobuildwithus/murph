Goal (incl. success criteria):
- Implement the reviewed assistant reliability fixes plus the requested follow-on refactors.
- Success means the confirmed bugs are fixed, failover planning is route-specific, assistant runtime state writes are serialized under one shared lock, dead assistant failover `maxAttempts` config is removed, focused tests cover the changes, and repo/docs verification is updated as needed.

Constraints/Assumptions:
- Keep assistant state file-backed and non-canonical.
- Preserve adjacent dirty-tree assistant work.
- Write-lock scope is limited to assistant runtime state (`receipts`, `outbox`, `diagnostics`, `failover`, `status`) unless a concrete blocker requires widening it.
- No live provider/channel calls in verification; rely on mocked CLI/runtime tests.

Key decisions:
- Remove dead assistant failover `maxAttempts` instead of implementing per-route retry counting in this turn.
- Refactor failover execution by splitting shared turn inputs from per-route provider execution context.
- Use one shared assistant-runtime write lock helper for runtime-state read-modify-write paths.

State:
- done

Done:
- Read repo routing/process docs and the supplied audit memo.
- Inspected the assistant runtime, outbox, status, failover, automation, and relevant tests.
- Registered the task in `COORDINATION_LEDGER.md`.
- Added this task plan and continuity ledger.
- Landed the reviewed bug fixes for deferred auto-reply artifacts, failover cooldown precedence, status cooldown/session filtering, same-process run-lock metadata, and manual delivery receipt preservation.
- Refactored assistant failover execution to derive provider-specific route plans per attempt instead of reusing the primary-provider plan.
- Added a shared assistant-runtime write lock for receipt/outbox/diagnostics/failover/status mutations and updated the affected paths.
- Added focused regression coverage and updated architecture/runtime docs.
- Verified with focused assistant Vitest coverage, `pnpm typecheck`, a passing `pnpm test:coverage`, and a direct built-CLI `assistant status --session` scenario.

Now:
- Remove the active coordination-ledger row and commit the scoped files.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- `pnpm test` still fails in `packages/cli/test/canonical-write-lock.test.ts` because its child process imports `packages/core/dist/constants.js` and then dies on a missing `@healthybob/contracts/dist/index.js` under `packages/core/node_modules`; this appears unrelated to the assistant-runtime diff.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-26-assistant-runtime-reliability-refactor.md`
- `packages/cli/src/assistant/service.ts`
- `packages/cli/src/assistant/outbox.ts`
- `packages/cli/src/outbound-channel.ts`
- `packages/cli/src/assistant/{failover,status,diagnostics,turns}.ts`
- `packages/cli/src/assistant/automation/{artifacts,runtime-lock,scanner}.ts`
- `packages/cli/test/{assistant-runtime,assistant-channel,assistant-observability,assistant-robustness,assistant-state}.test.ts`
