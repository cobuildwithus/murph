# Worker 04: Tool Runtime And Prompt Cut

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; actively look for independent subtasks and spawn focused subagents to parallelize exploration, implementation, or review while you keep the immediate critical path local. Give each subagent a narrow scope, explicit file ownership, and a requirement not to commit or revert unrelated work. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `ARCHITECTURE.md`

## Ownership

You own AI SDK tool/model harness deletion and prompt cleanup:

- `packages/assistant-engine/src/model-harness/**`
- `packages/assistant-engine/src/model-harness.ts`
- `packages/assistant-engine/src/assistant-cli-tools/**`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant-cli-access.ts`
- `packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`
- directly coupled prompt/tool/capability tests only when required

Avoid provider registry/turn-runner edits except to remove imports from your deleted modules. Worker 03 owns provider execution.

## Goal

Delete the AI SDK bound-tool runtime and prompt scaffolding that duplicates what Codex can do by directly running `vault-cli` and `murph`.

## Required Behavior

- Remove AI SDK `ToolSet` / `tool()` usage from assistant-engine.
- Remove `createAiSdkTools` and provider-visible tool schemas.
- Delete or disable `vault.cli.run` as a model-bound tool.
- Remove prompt language that says OpenAI-compatible providers should use bound assistant tools.
- Prompt Codex to use local `vault-cli` / `murph` directly.
- Keep any neutral content types needed by Codex image/text routing by moving them to a non-AI-SDK module if necessary.
- Delete web/search/PDF bound tools for this hard cut unless they are still needed outside assistant turns.
- Delete Health Commons/knowledge bound tools if direct CLI equivalents exist.
- Preserve guardrail concepts where possible in prompt/CLI guidance:
  - active vault scoping
  - do not run recursive assistant commands
  - prefer JSON output
  - use canonical CLI write paths
  - avoid secrets/log leakage

## Accepted Regressions

- Current-thread reminder helper can be lost until replaced by a CLI command.
- Hosted device connect helper can be lost until replaced by a CLI/runtime callback.
- Enriched meal promotion helper can be lost if no CLI equivalent exists.
- Web/PDF read guardrails can be lost for this cut if no direct CLI surface exists.

## Verification

Run residue checks for your owned files:

```sh
rg "from 'ai'|from \"ai\"|ToolSet|createAiSdkTools|vault.cli.run" packages/assistant-engine/src
pnpm --dir packages/assistant-engine typecheck
```

Focused prompt/tool tests may be deleted or rewritten. Final message must list deleted modules, moved neutral types, prompt changes, and tests/residue scans run.
