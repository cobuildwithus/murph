# Foreground hosted checkpoint tripwire

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Make normal foreground hosted workspace execution fail closed if it attempts to build or write a workspace checkpoint snapshot.

## Success criteria

- Normal hosted turns receive guarded checkpoint ports/builders that throw on foreground checkpoint attempts.
- Idle-shutdown checkpoint execution still receives the real checkpoint-capable port and builder.
- Tests prove normal hosted turns return when the real checkpoint port would hang.
- Tests prove any future normal-turn foreground call to `checkpoint()` or checkpoint request creation fails in-process.
- Tests prove normal hosted turns do not call the broad snapshot helpers.

## Scope

- In scope:
- `packages/assistant-runtime/src/hosted-runtime.ts`
- focused hosted-runtime tests
- Out of scope:
- idle-shutdown checkpoint ownership, Cloudflare container TTL changes, and broad hosted-runtime refactors.

## Constraints

- Preserve current mailbox import `deferCheckpoint` behavior.
- Keep the normal path simple and explicit; do not add a new checkpoint policy framework.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: accidentally disabling idle shutdown checkpoint compaction.
   Mitigation: leave idle shutdown wired to the real existing objects and add tests around the normal path only.
2. Risk: test-only mocks mask production helper calls.
   Mitigation: assert both the injected `createCheckpointSnapshot` and exported broad snapshot helpers are not called on the normal path.

## Tasks

1. Patch foreground workspace/checkpoint request guards.
2. Add focused regression tests.
3. Run focused verification and required audits.
4. Commit or report scoped-commit blockers.

## Decisions

- Use direct guard objects at the foreground runtime entrypoint instead of a generalized abstraction.

## Verification

- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime typecheck`
- Passed: `pnpm --dir packages/assistant-runtime test:coverage`
- Root `pnpm typecheck` was attempted and failed in unrelated `apps/web` hosted-workspace store/test typings already outside this task's working set.
Completed: 2026-05-09
