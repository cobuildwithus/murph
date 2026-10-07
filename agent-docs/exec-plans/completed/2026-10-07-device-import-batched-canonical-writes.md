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
  request. A job's first nonempty day commits alone; later consecutive closed
  days share one canonical import (up to eight days, 4,000 records, or what has
  accumulated after five seconds) after one fresh source-authority read.
- Yield, abort and retryable failure resume at the first uncommitted day; days
  already read commit before a retryable fetch failure. A yielded or aborted
  job's writes are rejected by the service, so the five-second accumulation
  bound guarantees progress before a pass deadline even when reads are slow.
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

## Review follow-up

- ReviewGPT round 1 (High, accepted): without a time bound, eight slow but
  successful reads could exceed the 300 s hosted pass before the first commit,
  and every later pass would repeat the same uncommitted prefix. Fix: flush
  after five seconds of accumulation (the full-job continuation budget), and
  mirror the one-day owner's yield handling instead of attempting a write
  after yield. Regression: six-second reads with a deadline every three reads
  import every day exactly once with no committed day re-read; it fails with
  the time bound disabled.

- ReviewGPT round 2 (High, accepted): the elapsed check runs only after a day
  is read, so a sub-five-second first day followed by a near-300 s paginated
  day still left nothing committed. Fix: a job's first nonempty day commits
  alone (as the one-day owner did), so every pass that completes a day keeps
  it; later days still batch. A 16-day job makes three writes instead of 16.
  Regression: a 4 s day then a 297 s day in a 300 s pass commits day one,
  resumes at day two without re-reading day one, and finishes in two passes;
  it fails without the first-day rule.

## Verification

- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage` in
  `packages/device-syncd`: 1,646 passed (69 files), including updated tests that
  assert per-day coverage instead of per-day import counts, commit-before-retry,
  live revocation after batch reads, and an eight-day batch yield resuming at
  day nine with no re-fetch of committed days.
- `pnpm complexity:diff`: debt 314 -> 314 in `junction.ts`.
- Not run locally: the hosted-local `device-sync-junction-wearable-direct-resource-replay`
  scenario stopped at the harness's local-only `prisma db push --force-reset`,
  which Prisma refuses to run for an AI agent without explicit owner consent.
Completed: 2026-10-07
