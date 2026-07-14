# PR 559 ReviewGPT Round 13

## Goal

Resolve the two accepted exact-head ReviewGPT recovery findings before merging PR 559:

1. Reclaim an expired exact companion RMSSD lease on the same local row even when the claim reached its attempt fence.
2. Adopt the sibling invalid-companion lane's terminal-code propagation so invalid encrypted work drains instead of replaying forever.

## Constraints

- Keep lease recovery in the existing SQLite job-store transaction.
- Keep the local scheduler as the only retry-timing owner; do not add a queue, replay table, or hosted retry policy.
- Preserve generic exhausted-lease dead-letter behavior.
- Do not overlap the active invalid-companion replay lane; adopt its tested acknowledgement change once committed.

## Working Set

- `packages/device-syncd/src/store/jobs.ts`
- `packages/device-syncd/test/store.test.ts`

## Verification Plan

- Prove an expired fenced companion lease reclaims the same row with an extended fence while an ordinary job still dead-letters.
- Adopt the sibling lane's proof that an invalid companion job promotes its exact dirty-payload acknowledgement while other failures remain retained.
- Run owner tests, typechecks, coverage, required completion audits, and diff checks.
- Push with an exact-head guard and run the next ReviewGPT round concurrently with CI.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
