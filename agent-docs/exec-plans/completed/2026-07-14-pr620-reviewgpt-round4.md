# PR 620 ReviewGPT Round 4

## Goal

Prevent ambiguous provider failures from replaying accepted work across a fresh Codex thread.

## Scope

- Delete resumed-turn fresh-thread fallback and its planning/diagnostic surface.
- Persist a failed provider turn's existing resume metadata through the existing session owner before surfacing the failure.
- Remove obsolete fence code and update focused recovery coverage without adding retry state.

## Verification

- Run focused assistant-engine tests, the full package suite, and typecheck.
- Complete coverage-write and security/privacy follow-up.
- Push, run ReviewGPT on the new exact head, and require green CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
