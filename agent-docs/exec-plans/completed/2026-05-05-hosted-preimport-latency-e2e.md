# Hosted Preimport Latency E2E

## Goal

Add a local e2e-style regression/profiling test that reproduces hosted runner pre-import latency with many mailbox messages and externalized workspace artifacts, then records enough stage evidence to identify what happens before initial mailbox fetch/import.

## Scope

- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- Test-only helpers in the same owner package if needed

## Constraints

- Keep production behavior unchanged unless instrumentation is proven necessary.
- Do not log raw identifiers, secrets, message bodies, or local paths.
- Prefer existing hosted runtime test harnesses over a new runner stack.

## Verification

- Focused assistant-runtime test command for the touched file.
- `pnpm typecheck` unless blocked by unrelated worktree state.

## Status

- Completed. Focused assistant-runtime verification passed; repo-wide diff verification is blocked by unrelated Cloudflare type errors in the dirty worktree.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
