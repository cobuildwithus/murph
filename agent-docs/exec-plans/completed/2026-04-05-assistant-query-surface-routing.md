# Assistant Query Surface Routing

## Goal

Teach Murph and the operator-facing CLI docs how to choose the canonical read surface with less exploration, especially across `show`, `list`, `search query`, `timeline`, `profile`, `wearables`, and import-manifest reads.

## Why now

- The prompt explains CLI discovery well, but still under-teaches which command family answers which question fastest.
- Generic read commands have weaker help than family-specific commands.
- A small shared routing vocabulary should reduce prompt churn and command exploration without redesigning the CLI.

## Scope

- Assistant system prompt routing guidance.
- Generic CLI read/search help text and command-manifest descriptions.
- Small README updates for the operator-facing “choose a read command” path.
- Focused regression tests for prompt/help text.

## Constraints

- Keep changes maximally simple and composable.
- Do not broaden into new command families or command-surface redesign.
- Preserve unrelated dirty worktree edits.

## Verification plan

- `pnpm --filter @murphai/assistant-core typecheck`
- `pnpm --filter @murphai/murph typecheck`
- Focused assistant-core and CLI Vitest coverage for the updated prompt/help surfaces
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
