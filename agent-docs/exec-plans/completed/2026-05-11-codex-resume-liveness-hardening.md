# Codex Resume Liveness Hardening

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add two small hosted assistant runtime hardening invariants:
  - Codex native-resume fallback must have an explicit prepared fresh-thread fallback plan.
  - Initial foreground runtime liveness that reports fresh input should return `scheduled` directly.

## Success Criteria

- Direct `executeCodexAssistantTurnAttempt` callers cannot resume a Codex provider session without a prepared fresh-thread fallback plan.
- Foreground hosted runtime work returns `scheduled` immediately when initial liveness reports fresh input, without relying on later abort/catch behavior.
- Focused regressions cover both invariants.
- Required focused verification and typecheck complete or blockers are explicitly identified.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
  - `packages/assistant-engine/test/codex-thread-instructions.test.ts`
  - `packages/assistant-runtime/src/hosted-runtime.ts`
  - `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- Out of scope:
  - Broad provider planning changes.
  - Cloudflare Durable Object scheduling changes.
  - Hosted deployment or production log inspection.

## Constraints

- Preserve existing planner behavior that already prepares `freshThreadFallback` when native resume is possible.
- Preserve the existing idle-shutdown checkpoint liveness handling.
- Do not print or persist raw prompts, messages, secrets, local identifiers, or provider request bodies.
- Preserve unrelated dirty worktree edits and active hosted runner plan rows.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/codex-thread-instructions.test.ts test/provider-registry-helpers.test.ts --no-coverage` passed, 34 tests.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage` passed, 48 tests.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/test/codex-thread-instructions.test.ts packages/assistant-engine/test/provider-registry-helpers.test.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed, including reverse-dependent assistant-cli, assistant-engine, assistant-runtime, assistantd, cli, setup-cli, and `apps/cloudflare verify`.
- `git diff --check` passed.
- Security/privacy review found no findings.
- Coverage-write review found coverage adequate and made no edits.
- Final completion review found no findings.

## Current State

- Implementation, focused tests, verification, and required audits are complete.
- Ready for scoped finish-task closeout.
Completed: 2026-05-11
