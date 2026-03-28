## Goal

Split stable assistant conversation identity from last successful provider binding, make provider statefulness/workspace behavior explicit through traits, and collapse provider execution callers onto one registry boundary.

## Success Criteria

- `AssistantSession` no longer stores mutable provider binding state inline with the stable conversation record in a way that failure recovery mutates canonical session state before a successful turn.
- The assistant service computes current-turn attempt state separately from the persisted last successful provider binding.
- Provider execution, prompt/message shaping, transcript-context policy, and traits live in one normalized provider boundary instead of duplicated wrapper layers.
- Route planning and recovery decisions use explicit provider traits rather than scattered provider-enum or `supportsDirectCliExecution` checks.
- Focused CLI tests cover session migration/persistence, resumed stateful providers, non-persisted recovery on failure, and provider trait/catalog behavior.

## Scope

- `packages/cli/src/{assistant-cli-contracts.ts,assistant-provider.ts,chat-provider.ts}`
- `packages/cli/src/assistant/{failover.ts,provider-catalog.ts,provider-registry.ts,provider-state.ts,provider-turn-recovery.ts,service.ts,store.ts,store/persistence.ts,store/types.ts}`
- Targeted CLI tests under `packages/cli/test/`.

## Risks / Notes

- This overlaps other active assistant-runtime lanes, especially service/runtime tests, so preserve adjacent edits and keep the write set focused on the session/provider seam only.
- Existing persisted session fixtures and restore paths still need legacy-read compatibility for current `v2` records.
- The repo currently has unrelated in-flight work, so repo-wide verification may expose unrelated failures that must be separated carefully from this lane.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
