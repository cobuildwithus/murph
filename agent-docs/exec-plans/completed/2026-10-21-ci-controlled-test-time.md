# Preserve timeout and retry proof with controlled test time

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Outcome and scope

Remove real waits from two existing fixtures without changing production code,
configured deadlines, retry policy, cancellation, cold restore or no-replay proof.
Fresh isolated base: `09623dc25434d0b25e187839ad6a5b0a66e1cf1d`.
Open-PR and registered-worktree checks found no overlapping edits on either test.
The parent owns candidate review and merge. The sibling audit owns test deletion;
this change removes no test, assertion, timeout, coverage or required gate.

## Owner and implementation

Junction already advanced fake timers, but native AbortSignal.timeout retained a
real 35-second wait. The fixture now uses the nearby controlled AbortController
pattern, checks that its signal remains live at 34,999 ms and aborts at 35,000 ms,
and asserts both requested deadlines. The original timeout/error/retryability and
request-count assertions remain. Finally restores the spy and clears fake timers.
Five unchanged native request-timeout/caller-abort cases retain native signal,
abort normalization and late-caller-abort race coverage.

Interrupted-recording already controls Date for its pre-due cold restore. The due
restore now controls only Date at the persisted retry timestamp, avoiding the
real minute-long sleep. The 60-second retry contract, pre-due retained state,
provider no-replay, checkpoint and foreground replacement assertions remain.
Timers, I/O, cancellation and the real ten-second liveness guard remain active;
finally restores Date before later cases and cleanup. No shared helper, state
owner, production constant, dependency or workflow changes are needed.

## Measured proof

Sequential local runs used the same macOS arm64 worker, Node 24.14.1, pnpm
10.33.0, Vitest 4.1.6, frozen dependencies and unchanged compiled capture worker.
Desktop background load was present; no other owned heavy job overlapped.
The controlled repeat restored identical per-package Vitest result-cache bytes
before each variant. Raw logs, JSON identities, cache hashes and harness scripts
are retained outside the checkout. These are command timings, not Ubuntu CI,
whole-pipeline, CPU or billing savings.

| Full file | Initial baseline -> candidate | Controlled repeat | Outcomes |
| --- | --- | --- | --- |
| Junction provider client | 40.310 -> 4.748 s | 39.516 -> 4.436 s | 47 passed, 0 failed/skipped |
| Interrupted system recording | 89.921 -> 29.665 s | 88.750 -> 28.766 s | 9 passed, 0 failed/skipped |

Test identities and statuses match in both pairs. Controlled target-case times
were 35,007.8 -> 8.5 ms and 62,132.8 -> 2,205.7 ms. Both optimized full files pass
in two fresh processes, including later cases after clock restoration.
The first direct recording attempt lacked its compiled capture-worker prerequisite;
that setup failure is excluded. The documented package build resolved it.

## Negative proof and limitations

Temporary mutations of the actual production owners proved original and optimized
fixtures both reject the same broken invariants, with exit 1:

- Mark a POST request timeout retryable: both fail `error.retryable === false`.
- Remove the recording recovery due-time fence: both fail the pre-due retained
  checkpoint-state equality, at the same assertion before the due invocation.

Mutation harnesses restore original production sources in finally. Production and
dependency files are absent from the final diff. This proves these invariants,
not all possible asynchronous races or complete native platform equivalence.

## Verification and completion

- Both package typechecks passed after the final TypeScript edits.
- `pnpm complexity:diff --base HEAD` passed; the guard excludes test fixtures.
  Manual review found only linear clock setup/assertions and bounded finally
  cleanup; no production complexity or new abstraction is introduced.
- `pnpm docs:drift`, doc gardening and whitespace checks passed.
- Changelog and Product UX are not applicable: internal test execution only.
- Final ReviewGPT is exempt under the low-risk tests rule: production retry,
  ordering, cancellation and external-effect contracts are unchanged. Parent
  candidate review remains required before Ready and normal exact-head CI.
- Draft publication and exact-head CI are subsequent delivery gates. No external
  source-review archive was uploaded. Parent alone merges; retain the open worktree.
Completed: 2026-10-21
