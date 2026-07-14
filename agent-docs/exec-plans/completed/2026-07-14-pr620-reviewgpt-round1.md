# PR 620 ReviewGPT Round 1

## Goal

Resolve the two accepted exact-head ReviewGPT findings without restoring Codex history-unsafe state or adding reconciliation machinery.

## Scope

- Preserve an accepted `finish_without_reply` decision when post-accept transcript-marker persistence fails.
- Persist already-known contract fingerprint and rollout-path facts for accepted no-reply provider failures so native resume remains usable.
- Add focused production-path coverage for the ordering and resume-state invariants.

## Verification

- Run focused assistant-engine tests and typecheck.
- Complete coverage-write and security/privacy review of the final patch.
- Push the new head, run ReviewGPT again, and require green CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
