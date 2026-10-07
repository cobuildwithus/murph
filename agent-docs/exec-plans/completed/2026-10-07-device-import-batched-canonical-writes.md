# Batch consecutive closed days per Junction canonical import

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Make large Junction history imports less canonical-write bound. Production
  evidence (2026-10-07, one member importing Apple Health history via
  Junction): heavy resource jobs made one canonical write per closed day
  (about 16 per job); canonical writes took 0.65-1.7 s each and about 75% of job
  time; and the hosted runtime's 63-receipt background boundary ended every
  invocation after about 25 jobs, about 26 runtime restarts per hour.

## Success criteria

- Historical and webhook resource jobs for uncapped dense `daily_aggregate`
  and `hourly_or_session_feature` resources still fetch one closed UTC day per
  request, but commit up to eight consecutive closed days (at most 4,000
  records) in one canonical import after one fresh source-authority read.
- Yield, abort and retryable failure resume at the first uncommitted day; days
  already read commit before a retryable fetch failure; after a job commits,
  no batch is written past a yield signal, preserving the receipt boundary's
  single admitted write.
- Calendar-day, capped, workout-stream and ECG resources keep one canonical day
  per write; full-job continuations are unchanged.

## Scope

- In scope: `importTimeseriesDailySnapshots` eligibility dispatch and a batched
  variant in `packages/device-syncd/src/providers/junction.ts`, its tests and
  `packages/device-syncd/README.md`.
- Out of scope: importer normalization, full-job continuations, the hosted
  receipt-log capacity, and in-process continuation after a receipt yield.

## Constraints

- Technical constraints: same provider requests, admission reads before commit,
  and idempotent replay through record identity; stay well under the
  importer's 10,000 normalized event bound.
- Product/process constraints: no member-visible change other than faster
  history imports.

## Risks and mitigations

1. Risk: per-window caps would truncate a multi-day window.
   Mitigation: any resource with `maxCanonicalRecordsPerWindow`,
   `maxRecordsPerWindow`, `maxSamplesPerWindow` or `maxSamplesPerRecord` is
   ineligible.
2. Risk: a session crossing midnight now normalizes in one snapshot.
   Mitigation: only dense daily/hourly normalizers are eligible, and they
   already accept multi-day snapshots (accumulated precise imports); the
   sparse identity-conflict filter is not on this path.
3. Risk: a revocation between fetch and commit.
   Mitigation: the batch's source-authority read follows every provider read
   in the batch, as the per-day path did for its day.

## Tasks

1. Add eligibility and the batched daily import; keep the per-day loop for all
   other resources.
2. Update tests that counted one import per day to assert day coverage instead.
3. Document the contract in the device-syncd README.

## Decisions

- Eight days and 4,000 records per batch: a 16-day job needs two writes instead
  of 16 while staying far below importer bounds.
- Changelog: internal performance change; no member-visible behavior.

## Verification

- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage` in
  `packages/device-syncd`: 1,644 passed (69 files), including updated tests that
  assert per-day coverage instead of per-day import counts, commit-before-retry,
  live revocation after batch reads, and an eight-day batch yield resuming at
  day nine with no re-fetch of committed days.
- `pnpm complexity:diff`: debt 314 -> 314 in `junction.ts`.
- Not run locally: the hosted-local `device-sync-junction-wearable-direct-resource-replay`
  scenario stopped at the harness's local-only `prisma db push --force-reset`,
  which Prisma refuses to run for an AI agent without explicit owner consent.
Completed: 2026-10-07
