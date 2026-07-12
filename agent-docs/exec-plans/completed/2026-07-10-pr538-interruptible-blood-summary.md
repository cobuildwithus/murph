Goal (incl. success criteria):
- Resolve PR #538's accepted ReviewGPT finding without weakening personal-evidence grounding.
- Success means context-snapshot blood-test navigation uses a canonical lifecycle-aware event-ledger summary, never triggers the broad query projection, and can yield between JSONL records while preserving dirty retry state.

Constraints/Assumptions:
- Keep core as the event-ledger/lifecycle owner; do not recreate canonical collapse rules in assistant code.
- Add no persisted state, schema, projection, queue, cursor, or compatibility layer.
- Preserve latest-live-panel semantics across shards and tombstones, and keep the user-visible snapshot line unchanged.
- Background preemption must remain an `AbortError` to the snapshot layer so best-effort refresh preserves pending dirty domains.

Key decisions:
- Replace `listBloodTests(..., { limit: 1 })` with a narrow core summary that reads only health-history event shards.
- Reuse core's existing stored-history parser, blood-test classifier, and event-spine collapse.
- Add a small interruptible JSONL reader that checks the caller's continuation predicate before each record; no whole-file buffering on this path.

State:
- Complete.

Done:
- Validated the ReviewGPT finding from the hosted idle-refresh call path through `listBloodTests`, `readVault`, and projection rebuild/hydration.
- Confirmed core already owns the canonical event ledger, health-history parsing, blood-test classification, and lifecycle collapse.
- Added a streaming JSONL visitor that checks continuation between records and closes its owned stream on every exit.
- Added the narrow lifecycle-aware latest blood-test summary and switched context snapshot refresh off the query projection.
- Added regressions for latest-live tombstone semantics and production-path interruption before a later invalid record.
- Passed focused core and assistant-engine tests and typechecks; security/privacy review found no medium-or-higher findings.
- Coverage-write found no remaining proof gap. Both exact affected-lane attempts passed guards, all 18 affected package typechecks, and 581 core tests; differing assistant-runtime timeout flakes passed in exact isolation.

Now:
- None.

Next:
- Commit and publish the completed PR follow-up, then run the repository PR review loop on the new head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/core/src/jsonl.ts
- packages/core/src/history/api.ts
- packages/core/src/index.ts
- packages/core/test/health-history-family.test.ts
- packages/assistant-engine/src/assistant/context-snapshot.ts
- packages/assistant-engine/test/assistant-context-snapshot.test.ts
- pnpm test:diff packages/core packages/assistant-engine
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
