# PR 620 ReviewGPT Round 2

## Goal

Prevent fresh-thread fallback from replaying an accepted `finish_without_reply` decision or discarding the fallback turn's existing failure context.

## Scope

- Reuse one provider failure mapper for primary and fallback app-server errors.
- Fence fallback when the primary failure already contains an accepted no-reply ordinal.
- Preserve fresh fallback continuation, accepted ordinals, reactions, thread, rollout, usage, and diagnostics on failure.
- Add focused provider-adapter and runner/local recovery coverage without new state or lifecycle machinery.

## Verification

- Run focused assistant-engine tests and typecheck.
- Complete coverage-write and security/privacy follow-up.
- Push, run ReviewGPT on the new exact head, and require green CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
