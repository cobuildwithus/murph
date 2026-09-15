# Increase bounded device-sync sweep capacity

## Outcome

Raise the existing scheduled device sweep default from 25 to 100. Report the
limit-plus-one sentinel as backlog presence, preserving the 250-item hard cap,
five-operation concurrency, access checks, and canonical scheduled-wake owner.

## Product UX

- Outcome: More due wearable connections can begin scheduled recovery per sweep.
- Reaches: Existing eligible active connections; unchanged consent and access boundaries.
- Proof: Empty, full, overflowing, maximum-cap, slow-provider, unchanged-content,
  dirty-recovery, failure, and signed-route scenarios. Verify handoff acceptance;
  do not claim live provider import completion or measured production latency.

## Design and failure boundary

The current base probes every selected ordinary Junction connection. Its provider
probe timeout is 20 seconds, so 100 slow probes in five slots could consume over
six minutes. Stop starting optional preflights after 60 seconds of monotonic batch
time, drain owned work, and use existing scheduled wakes for remaining candidates.
This is an admission budget, not a total callback deadline. No new persistence,
queue, retry owner, dependency, or live-authority bypass is introduced.

## Steps

1. Update sweep default, backlog telemetry, focused tests, and reliability owner.
2. Add a concise member changelog and run focused tests, Web typecheck, lint,
   and complexity review.
3. Commit, push draft PR, complete candidate evidence, mark Ready, and start
   ReviewGPT concurrently with exact-head CI. Merge after all gates pass.

## Validation

- Seven focused Web files: 56 tests passed (sweep, recovery wrapper, signed
  route, recovery concurrency, store selection, preflight, and changelog page).
- Web `typecheck:prepared`: passed after Health Commons and Prisma preparation.
- Focused ESLint: passed. Complexity guard: passed, maximum 17 to 20,
  no changed-source functions above 20. Diff whitespace and privacy checks passed.
- Parent candidate review: Ready at the scheduled-wake admission boundary.
  Production backlog size, age, provider completion, and latency are unmeasured.
- Implementation and local proof complete. PR #3471 owns final ReviewGPT,
  exact-head CI, and merge evidence; these external gates remain pending at
  archival. The release note references that PR.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
