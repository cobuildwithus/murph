# Reduce scheduled canary admissions to approximately one-third

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Outcome and invariants

Reduce existing protected live canary schedule frequency using UTC calendar
entries only. Preserve all manual/PR/push/release admission, credentials,
source pins, assertions, reply budgets, concurrency, and failure handling.
Current main uses six-hour Linq and twelve-hour native schedules. Target nine
and five weekly slots respectively; prior reductions are not new savings.

## Ownership and design

The three existing public workflows remain the sole schedule owners. No new
state, scheduler, skip job, dependency, or runtime logic. PR #4236 owns diagnostics;
its workflow inventory is disjoint and its diagnostic source remains untouched.
Cadence-only documentation updates preserve its existing owner contracts.
UTC weekly calendars avoid DST and month-boundary interval resets. Nominal gaps
are 18–24 hours for Linq and 24–36 hours for native platforms; manual recovery
is available under unchanged admission. Actual runs may be delayed by GitHub.

## Verification and completion

- Baseline: three focused controller suites pass 30 tests.
- Post-change controller suites pass all 30 tests. YAML parse and enumeration across
  2026–2027 prove nine/five weekly slots, no duplicates, and the stated gap bounds.
- Parsed workflow comparison proves every non-schedule field unchanged except the
  cadence-neutral LINQ display name; comments are non-executable.
- Parent candidate review, scoped commit, draft PR, final ReviewGPT, exact-head CI.
- Merge only after required gates; parent coordinates shared production releases.
- Verify schedules on protected main; observe natural runs without paid dispatches.

## Candidate review

Focused proof and docs drift pass. Complexity guard passes with no authored
production JS/TS to analyze. Parent inspected the complete diff: no workflow
job body, assertion, source pin, permission, concurrency or non-schedule trigger
changes. Cadence uses UTC and preserves native 30-minute staggering. Local
implementation is complete; final external review and exact-head CI remain
required before merge. Coordination note is recorded on PR #4236; its existing
owner retains all diagnostic and release work.
Completed: 2026-10-20
