# Integration Ingest Archives

## Goal

Allow closed monthly `ledger/integration-ingests` shards to be stored compressed while preserving existing integration-ingest read and repair behavior.

## Constraints

- Keep canonical writes owned by `packages/core`.
- Keep default query/read visibility unchanged; this is a repair/debug evidence read-path change.
- Do not expose raw provider payloads, local paths, or direct identifiers in logs, tests, docs, or handoff.
- Preserve live monthly JSONL append behavior; compressed closed months must not become an accidental append target.

## Approach

- Add one shared integration-ingest row iteration primitive that reads live `.jsonl` monthly shards and supported compressed monthly archives.
- Wire existing integration-ingest read APIs through that primitive.
- Add focused tests proving reads and id lookup still work when an old month exists only as a compressed archive.
- Reject multiple physical representations for the same logical shard during rollout, and bound ZIP archive reads before inflate.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/core/src/integration-ingests.ts packages/core/test`
- `pnpm test:smoke`

## State

- Status: active
- Started: 2026-07-08
- Deep-review hardening: added early representation-conflict errors and ZIP size/central-directory validation.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
