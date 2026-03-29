# 2026-03-30 assistantd hardening and simplification

## Goal

Land the supplied assistantd hardening/simplification patch on top of the current tree without regressing the existing assistant/provider/runtime work already in progress.

## Success Criteria

- `packages/assistantd` enforces loopback-only access, stricter request validation, bounded body sizes, and session-id validation on daemon routes.
- Shared loopback validation lives in `packages/runtime-state` and is reused by assistantd client/server code.
- The CLI assistant runtime hardens opaque state ids, reply sanitization, status/session/outbox/cron reads, and transcript-distillation corruption handling without leaking local storage paths.
- Focused assistantd and CLI regression coverage passes, and repo-required verification plus direct daemon-boundary proof are recorded.

## Scope

- `packages/assistantd/**`
- `packages/runtime-state/src/{index.ts,loopback-control-plane.ts}`
- `packages/cli/src/assistant{,-daemon-client}.ts`
- `packages/cli/src/assistant/**`
- Targeted assistant daemon/runtime tests and any minimal doc updates required by trust-boundary behavior changes.

## Constraints

- Preserve unrelated in-flight assistant/provider/runtime edits already present in the worktree.
- Keep `assistant-state/**` non-canonical and rebuildable.
- Do not widen assistant delivery behavior or canonical vault writes.
- Prefer reusing existing helpers and exported seams over duplicating loopback/path/state-id logic.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- One direct daemon-boundary scenario check against the hardened HTTP server behavior

## Outcome

- Implemented the supplied assistantd/CLI/runtime hardening patch cleanly on top of the live tree, including loopback-only daemon trust boundaries, opaque assistant state-id validation, safer daemon-backed runtime-state reads, and transcript-distillation quarantine/diagnostics.
- Added focused regression coverage for assistantd request validation plus CLI daemon/runtime/privacy behavior.
- Required audit passes completed via spawned agents with no blocking findings.

## Verification Notes

- Passed: `pnpm --dir packages/assistantd typecheck`
- Passed: `pnpm --dir packages/assistantd test`
- Passed: `pnpm --dir . exec vitest run packages/cli/test/assistant-daemon-client.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- Passed: targeted `packages/cli/test/assistant-service.test.ts` cases covering outbound sanitization and sensitive-context delivery overrides
- Passed direct daemon-boundary probe: invalid session route returned `400`, oversized request body returned `413`, and `/open-conversation` returned `{ created, session }` without `paths`
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` still fail for unrelated pre-existing `apps/web` typecheck errors in `src/lib/hosted-execution/hydration.ts` and `src/lib/hosted-execution/usage.ts`
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
