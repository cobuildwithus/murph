# 2026-04-04 Assistant Memory CLI Cutover

## Goal

Port assistant memory Markdown file reads and edits into the canonical `vault-cli assistant memory ...` surface so provider turns no longer need mirrored direct memory-file tools.

## Scope

- `packages/assistant-core/src/assistant/memory-files.ts`
- `packages/assistant-core/src/assistant-cli-contracts.ts`
- `packages/assistant-core/src/assistant-runtime.ts`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- `packages/cli/src/commands/assistant.ts`
- Focused provider/runtime tests under `packages/cli/test/**`

## Constraints

- Keep the existing memory-file validation and privacy rules intact.
- Do not make the CLI import sibling package internals outside declared public assistant-core entrypoints.
- Remove only the mirrored provider-turn memory-file tools; leave the broader CLI executor cutover intact.
- Preserve unrelated dirty-tree edits in assistant prompt/runtime files.

## Plan

1. Move assistant memory Markdown file read/append/write behavior into a shared assistant-core module with explicit result shapes.
2. Register canonical `assistant memory file read|append|write` CLI commands that use that shared implementation.
3. Remove the provider-turn mirrored memory-file tools and update prompt guidance/tests to use the CLI path instead.
4. Run focused verification, typecheck, required audit, and close the plan with a scoped commit.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
