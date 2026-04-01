# Assistant-Core Provider Review Patch

## Goal

Land the supplied assistant-core patch so OpenAI Responses resume stays route-scoped and corrupted provider-route-recovery secret state fails closed instead of silently downgrading to "no recovery."

## Why

- The current turn runner builds a route-scoped resume binding, then still falls back to the active binding for OpenAI Responses and can pass a stale `previousResponseId` into a different route/config.
- The current route matcher treats official OpenAI Responses bindings as universally resumable, which weakens the repo's documented route-scoped recovery design.
- The current provider-recovery loader catches secret-sidecar corruption and returns `null`, silently converting trust-bearing recovery corruption into missing state.

## Scope

- `packages/assistant-core/src/assistant/{provider-binding.ts,provider-turn-runner.ts,provider-turn-recovery.ts}`
- focused `packages/cli/test/{assistant-service.test.ts,assistant-state.test.ts}`

## Constraints

- Preserve existing assistant provider behavior outside the route-scoped resume and corrupted-recovery cases.
- Keep the OpenAI Responses legacy fallback backward-compatible only for bindings that predate stored route markers, and require normalized config equality in that case.
- Do not widen into the broader hosted usage-context or provider-agnostic tool-executed metadata follow-up.
- Preserve unrelated dirty worktree edits, especially other active assistant-core and runtime lanes.

## Verification

- Focused assistant-core regression tests for the touched resume and recovery seams
- Required repo verification for `packages/assistant-core`
- Required completion-review audit pass before handoff

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
