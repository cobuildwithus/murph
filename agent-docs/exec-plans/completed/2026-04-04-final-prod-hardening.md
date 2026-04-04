# Final Prod Hardening

## Goal

Land the remaining useful deltas from the final production hardening patch on top of the current hosted state.

## Scope

- Restrict hosted user root-key recipient updates to user-managed recipient kinds only.
- Tighten hosted browser root-key recipient handling to require the expected key size and user-managed recipient kinds.
- Reuse the already-landed shared storage-path helper instead of re-adding duplicate storage-path code.

## Constraints

- Treat the supplied patch as intent only; some hunks already landed or drifted.
- Preserve unrelated dirty assistant-core work.
- Keep scope to hosted root-key hardening only.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused Vitest reruns for touched hosted root-key tests if needed

Completed:

- `git diff --check`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/index.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-browser-user-keys.test.ts`
- `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution.test.ts`
- `pnpm typecheck`
- `pnpm --dir apps/web lint` (warnings only; no errors)

Known unrelated repo failures:

- `pnpm test`
- `pnpm test:coverage`

Both fail in existing CLI tests outside this task:

- `packages/cli/test/json-input.test.ts`
- `packages/cli/test/assistant-service.test.ts`

## Status

- Complete
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
