# Worker 03: Assistant Engine Execution Cut

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; actively look for independent subtasks and spawn focused subagents to parallelize exploration, implementation, or review while you keep the immediate critical path local. Give each subagent a narrow scope, explicit file ownership, and a requirement not to commit or revert unrelated work. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `ARCHITECTURE.md`
- `agent-docs/operations/verification-and-runtime.md`

## Ownership

You own active assistant-engine provider execution:

- `packages/assistant-engine/src/assistant/providers/**`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/provider-turn/**`
- `packages/assistant-engine/src/assistant/provider-catalog.ts`
- `packages/assistant-engine/src/assistant/provider-config.ts`
- `packages/assistant-engine/src/assistant/service-turn-routes.ts`
- `packages/assistant-engine/src/assistant/session-resolution.ts`
- `packages/assistant-engine/src/assistant/store/**`
- `packages/assistant-engine/src/assistant/state-secrets.ts`
- directly coupled assistant-engine tests only when required for compile

Avoid editing `assistant-codex.ts` except to consume Worker 02 exports. Avoid editing model-harness/tool definitions; Worker 04 owns those.

## Goal

Remove Murph's active OpenAI-compatible/Responses provider execution path. Codex App Server is the only assistant turn runner.

## Required Behavior

- Provider registry exposes only Codex for assistant turns.
- Old OpenAI-compatible sessions/configs fail closed rather than executing.
- Provider turn planning no longer builds AI SDK tool-runtime execution plans.
- Provider turn runner no longer imports OpenAI-compatible helpers.
- Remove Vercel AI Gateway billing/request-header logic from assistant-engine provider execution.
- Remove provider-family failover between Codex/OpenAI-compatible/Responses.
- Keep Murph's runtime envelope intact:
  - active-turn journal
  - turn lock
  - transcript persistence
  - diagnostics
  - outbox finalization
  - automation/cron
  - channel delivery
- Preserve Codex provider strict behavior:
  - execution driver `codex-app-server`
  - `approvalPolicy=never`
  - direct CLI authority
  - native Codex thread resume

## Deletion Bias

Delete active OpenAI-compatible code rather than hiding it behind conditionals. If a type from old code is still needed only for parsing, move it to a small legacy/fail-closed seam or consume Worker 01's operator-config legacy parse output.

## Coordination

Worker 02 owns the Codex app-server adapter. Consume its exported types when available. If your branch needs a placeholder type before Worker 02 lands, keep it narrow and easy for the parent integrator to reconcile.

Worker 04 owns model-harness and bound-tool deletion. Remove call sites to those modules from your owned files.

## Verification

Run focused assistant-engine checks if possible:

```sh
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-engine test -- provider
pnpm --dir packages/assistant-engine test -- assistant-local-service
```

If tests are mid-transition, run `pnpm --dir packages/assistant-engine typecheck` and report test fallout for Worker 07.

Final message must list removed execution branches, changed files, tests run, and any remaining OpenAI-compatible residue you intentionally left.
