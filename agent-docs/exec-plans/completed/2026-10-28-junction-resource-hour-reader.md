# Read hourly Junction resource continuations before producer rollout

Status: completed
Created: 2026-10-28
Updated: 2026-10-28

## Goal

Accept supplied hourly resource continuations before enabling the oversized-day
producer in PR #4377. Keep existing daily behavior and canonical source authority.

## Owner and evidence

`device-syncd` owns manifest admission, durable jobs and provider execution. The
existing full-job hourly importer already bounds complete-hour reads. Resource
jobs currently reject the scalar at service admission and otherwise reread a full
day. Synthetic reader proof fails on the unchanged base (six failures, two
controls pass), including a service/store/cold-restore/hosted-hint composition.
No production event is replayed or mutated.

## Smallest change

Admit the existing scalar for resource jobs and reuse the bounded import owner
for one complete hour. Existing payload spreading preserves the marker on a
continuation; no new queue, state owner or suffix-retention mechanism is needed.
Keep daily aggregate, workout-stream, unmarked oversized-day and full-job policy
unchanged. This reader does not generate the marker after a daily overflow.

## Compatibility and rollout

Old producers emit unmarked resource jobs, accepted by old and new readers.
New readers also accept the future hourly marker. Old readers reject or widen it,
so producer #4377 remains held until compatible Web and runner readers are live,
with exact release receipts and warm invocation convergence. After producer
admission, the compatible reader becomes the rollback floor while hourly jobs
remain durable. No cleanup, historical replay or permission change is part of
this release. This task owns both stages; no independent release is reserved.

## Tasks

1. Implement the reader and focused compatibility proof.
2. Run focused tests, typecheck, complexity and parent candidate review.
3. Open draft PR, then admit the stable candidate to independent final ReviewGPT
   and required exact-head CI. No formal PR approval is authorized.
4. Coordinate merge and normal reader rollout; verify serving fleet and warm
   convergence before admitting the separate producer.

## Verification

- Baseline: reader regression 6 fail / 2 pass on unchanged source.
- Candidate: 189 focused reader/full-job/manifest/hint/runtime tests pass; package
  typecheck passes. Complete-hour bounds, invalid coordinates/markers, source
  recheck, yield-before-read, overflow without partial import, all 24 suffixes,
  service enqueue, SQLite cold restore and hosted hint normalization are covered.
- Complexity: passes, junction debt remains 314 and maximum 95; unused parameter
  defaults removed from the single-caller daily import owner. The hourly branch
  does not increase existing hotspot complexity. Parent full-diff review passes.
- Independent final review and required exact-head CI remain PR completion gates.
- Deployment and natural verification: pending; no runtime wake or replay.

## Changelog decision

Internal compatibility prerequisite only: no producer, new member action or
new daily-overflow recovery is enabled. The producer owns the visible change.
Completed: 2026-10-28
