# Worker 07: Tests And Fixtures

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; actively look for independent subtasks and spawn focused subagents to parallelize exploration, implementation, or review while you keep the immediate critical path local. Give each subagent a narrow scope, explicit file ownership, and a requirement not to commit or revert unrelated work. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `agent-docs/operations/verification-and-runtime.md`

## Ownership

You own test and fixture fallout from the hard cut:

- `packages/assistant-engine/test/**`
- `packages/operator-config/test/**`
- `packages/assistant-runtime/test/**`
- `packages/cli/test/**`
- `apps/cloudflare/test/**`
- fixture files directly coupled to removed provider/model route behavior

Avoid production source edits except tiny compile-only test seams after checking whether another worker owns the source file.

## Goal

Make tests reflect the Codex-only assistant runtime.

## Required Test Changes

- Delete obsolete AI SDK/OpenAI-compatible provider execution tests.
- Delete obsolete model-harness/Responses-policy tests if their source modules are removed.
- Rewrite provider registry/config tests to expect Codex-only active runtime.
- Add or update coverage for:
  - Codex `modelProvider`
  - Vercel AI Gateway as Codex model provider
  - hosted Codex config bootstrap
  - `turn/steer` request builder or runner behavior
  - `turn/interrupt` remains supported
  - old OpenAI-compatible sessions/config fail closed
  - disabled/deleted `inbox model route`
  - no active AI SDK imports in assistant runtime code
- Keep mailbox/checkpoint/outbox tests intact unless assertions mention the old provider runtime.

## Coordination

Source workers may leave tests red while they are editing. Prefer waiting until files settle before broad rewrites. If you run concurrently, use `git diff` and `rg` to identify actual current source behavior.

## Verification

Run focused tests as they become meaningful:

```sh
pnpm --dir packages/operator-config test -- assistant
pnpm --dir packages/assistant-engine test -- codex
pnpm --dir packages/assistant-runtime test -- hosted-assistant
pnpm --dir packages/cli test -- assistant
pnpm --dir apps/cloudflare test -- hosted
```

Final message must list deleted test files, rewritten expectations, commands run, and remaining failing tests with likely source owner.
