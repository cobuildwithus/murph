# Assistant CLI Surface Bootstrap

## Goal

Give Murph a small, accurate map of the vault CLI surface at session bootstrap by generating a compact summary from `vault-cli --llms --format json`, caching it once per session, and injecting it through continuity context instead of expanding the main system prompt.

## Why now

- The current prompt explains how to discover the CLI, but it does not preload any shape of the CLI surface.
- A compact bootstrap summary should improve first-turn CLI navigation without paying the token cost of injecting the full `--llms` manifest on every turn.
- The assistant session schema should stay unchanged; bootstrap state can live in assistant state scratch storage.

## Scope

- Assistant-core runtime helpers for generating and caching the summary.
- Provider-turn bootstrap wiring to include the summary in continuity context when bootstrap context is already being injected.
- Focused tests around summary generation and bootstrap continuity behavior.

## Constraints

- Preserve existing native-resume behavior; do not force extra continuity context onto resumed provider sessions.
- Reuse existing CLI launch resolution instead of inventing another `vault-cli` execution path.
- Keep the summary small, plain text, and derived from the compact `--llms --format json` manifest.
- Preserve unrelated dirty worktree edits, especially existing assistant prompt/runtime changes.

## Verification plan

- `pnpm --filter @murphai/assistant-core typecheck`
- `pnpm --filter @murphai/murph typecheck`
- Focused assistant-core and CLI Vitest coverage for the new bootstrap path
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
