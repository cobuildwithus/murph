# Raw Kernel Playwright

## Goal

Replace the brittle hosted `computer_act` structured action surface with a direct Kernel Playwright execution tool so the assistant can use normal Playwright code for browser tasks.

## Success Criteria

- The assistant dynamic tool accepts Playwright/TypeScript code for an existing hosted computer run.
- Web execution preserves run/member ownership, runnable-run gating, public-navigation validation, timeout caps, and browser state cache updates.
- The old locator/action schema, sensitive-input preflight, and key allowlist are deleted rather than extended.
- Skill and security docs state the deliberate authority tradeoff: raw Playwright code may access normal Playwright browser surfaces, so sensitive handling is policy/handoff-driven rather than heuristic-blocked.
- Focused package/web tests and typecheck pass, or any unrelated blocker is documented precisely.

## Scope

- `packages/hosted-execution/src/computer-use.ts`
- `apps/web/src/lib/computer-use/**`
- `apps/web/app/api/internal/computer/runs/[runId]/**`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- Relevant tests and durable docs

## Non-Goals

- No new browser sandbox/facade architecture.
- No cookie/storage blacklist parser.
- No new scheduler, queue, persisted product state, or Kernel wrapper service.

## Verification Plan

- Focused hosted-execution parser tests.
- Focused assistant-engine computer tool tests.
- Focused apps/web computer-use service tests.
- `pnpm typecheck`.
- Required security/privacy and coverage audits for trust-boundary code.

## State

- Branch started from current `main`.
- Main checkout had unrelated dirty hosted-computer edits; this work is isolated in a separate worktree.
- Implemented raw `computer_act` request schema (`code`, `timeoutMs`), web execution wrapper, metadata-only failure logs, assistant dynamic-tool schema, prompt/skill/docs updates, and focused test rewrites.
- Audit fixes applied: model-facing start-run no longer accepts `resumeRunId` or proof fields, `finish_without_reply` is allowed after `computer_pause_for_user`, Kernel execution failures return metadata-only booleans/code hash/timeout instead of raw streams, `timeoutMs` is advertised as an integer, and action final URLs are server-validated as public before cache update.
- Focused verification passed:
  - `pnpm --dir packages/hosted-execution test -- hosted-execution.test.ts`
  - `pnpm --dir packages/hosted-execution test -- hosted-execution.test.ts hosted-runtime-control.test.ts`
  - `pnpm --dir packages/assistant-engine test -- assistant-codex-computer-tools.test.ts assistant-codex-runtime.test.ts assistant-skill-assets.test.ts model-behavior.test.ts`
  - `pnpm --dir packages/assistant-engine test -- assistant-skill-assets.test.ts` (runs the assistant-engine suite under the package config)
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-execution apps/web/test/hosted-execution-computer-use.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-store-config apps/web/test/hosted-computer-runtime-log.test.ts`
  - `pnpm typecheck`
- Initial web broad workspace test invocation failed before focused tests because generated Prisma/Health Commons artifacts were missing in the fresh worktree; generated artifacts were prepared and the targeted web tests then passed.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
