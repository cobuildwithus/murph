# Worker 02: Codex App Server Runner

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; actively look for independent subtasks and spawn focused subagents to parallelize exploration, implementation, or review while you keep the immediate critical path local. Give each subagent a narrow scope, explicit file ownership, and a requirement not to commit or revert unrelated work. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `ARCHITECTURE.md`
- official Codex App Server docs if needed

## Ownership

You own the Codex App Server adapter/runner:

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/**`
- directly coupled Codex runtime tests, especially `packages/assistant-engine/test/assistant-codex-*.test.ts`

Avoid editing provider registry, operator-config, CLI, hosted-runtime, and package manifests unless a tiny compile edge is unavoidable.

## Goal

Turn the existing per-turn Codex App Server adapter into the foundation for the only assistant chat runner.

The hard-cut target is Codex App Server, not `codex exec`.

## Required Behavior

- Add `modelProvider` to `CodexAppServerTurnInput`.
- Forward `modelProvider` through `thread/start` and `thread/resume` params.
- Preserve model, profile, OSS mode, Codex command, Codex home, sandbox, approval policy, reasoning effort, image support, config overrides, and working directory behavior.
- Capture Codex `threadId` and Codex `turnId`.
- Preserve `turn/interrupt` on abort.
- Add a typed path for `turn/steer` against a live `{ threadId, turnId }`.
- Return enough normalized data for assistant-engine to persist session/resume state and report final response.
- Keep failure handling for:
  - missing Codex executable
  - invalid Codex home
  - stale resume
  - interrupted turn
  - process exit
  - app-server RPC timeout
  - unexpected interactive server requests under `approvalPolicy=never`
- Do not introduce SDK/AI SDK dependencies.

## Design Preference

If a full long-lived runner class is too large for this lane, make the smallest durable seam that can support it:

```ts
type CodexAppServerSteerInput = {
  threadId: string
  turnId: string
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
}
```

and expose lower-level request builders/tests for `turn/steer`. The parent integrator can wire lifecycle across workers.

## Verification

Run focused Codex tests if possible:

```sh
pnpm --dir packages/assistant-engine test -- assistant-codex
```

Also run direct smoke if safe:

```sh
codex --version
codex app-server --help
```

Final message must list changed files, runner API exported symbols, tests run, and any expected follow-up for Worker 03.
