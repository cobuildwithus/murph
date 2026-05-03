# Thread instructions resume refresh

## Goal

Stop resending stable Codex thread instructions on every native resume while still refreshing the upstream thread when the installed stable instruction payload changes.

## Scope

- Extend assistant session resume state with a stable thread-instructions fingerprint.
- Forward a resume instruction-refresh decision from planner to Codex App Server.
- Keep dynamic per-turn context in the user turn prompt.
- Preserve native provider resume when the fingerprint matches.

## Non-Goals

- Do not change user-facing prompt behavior beyond removing redundant resumed-thread instruction refreshes.
- Do not redesign route ids or provider session ownership.
- Do not touch unrelated onboarding bootstrap work already active in the tree.

## Verification Plan

- Focused assistant-engine/operator-config tests for resume-state persistence and Codex resume params.
- `pnpm typecheck`.
- `pnpm test:diff` scoped to touched files if truthful.

## State

Active.
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
