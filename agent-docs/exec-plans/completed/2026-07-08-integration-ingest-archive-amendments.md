# Integration Ingest Archive Amendments

## Goal

Allow legitimate historical device backfills to append integration-ingest evidence
to an already archived monthly shard without leaving both live and archived
representations behind.

## Constraints

- Keep canonical integration-ingest writes owned by `packages/core`.
- Preserve generic archive immutability: ordinary JSONL appends, text writes,
  deletes, and hosted receipt replays must not mutate archived shards unless the
  integration-ingest append planner explicitly opted in.
- Preserve duplicate replay behavior for archived months.
- Do not add a second index, queue, state owner, or archive format.

## Approach

- Extend the existing integration-ingest append plan with an explicit archived
  amendment target when new rows belong to an archived shard.
- Keep generic append paths rejected unless they carry the integration-ingest
  archive-amendment opt-in.
- Apply the amendment by reading the existing archive, appending validated rows,
  and atomically rewriting the same single-entry archive representation.
- Include the same opt-in in hosted canonical write receipts so replay can amend
  archives through the same path.
- Add focused regressions for direct device-style append and hosted replay.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/core/src/integration-ingests.ts packages/core/src/operations/write-batch.ts packages/core/test/integration-ingests.test.ts`
- `pnpm test:smoke`

## State

- Status: active
- Started: 2026-07-08
- Implemented opt-in archive amendments through the existing integration-ingest
  append plan and write batch JSONL action.
- Verification passed:
  - `pnpm --dir packages/core test integration-ingests.test.ts`
  - `pnpm exec tsc --noEmit --pretty false --project packages/core/tsconfig.json`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/core/src/atomic-write.ts packages/core/src/integration-ingests.ts packages/core/src/mutations.ts packages/core/src/operations/write-batch.ts packages/core/test/integration-ingests.test.ts`
  - `pnpm test:smoke`
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
