# Reduce scheduled canary admissions to approximately one-third

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Outcome and invariants

Reduce existing protected live canary schedule frequency using UTC calendar
entries only. Preserve all manual/PR/push/release admission, credentials,
source pins, assertions, reply budgets, concurrency, and failure handling.
Current main uses six-hour Linq and twelve-hour native schedules. Target nine
and five weekly slots respectively; Garmin and Stripe move from seven to two
weekly slots each (Monday/Thursday UTC, 72/96-hour gaps); prior reductions are not new savings.

## Ownership and design

The five existing public workflows remain the sole schedule owners. No new
state, scheduler, skip job, dependency, or runtime logic. PR #4236 owns diagnostics;
its workflow inventory is disjoint and its diagnostic source remains untouched.
Cadence-only documentation updates preserve its existing owner contracts.
PR #3134 owns Privy retirement; its three Stripe environment removals are disjoint
from this schedule-only edit, coordinated in its PR before editing.
UTC weekly calendars avoid DST and month-boundary interval resets. Nominal gaps
are 18–24 hours for Linq and 24–36 hours for native platforms; manual recovery
is available under unchanged admission. Actual runs may be delayed by GitHub.

## Verification and completion

- Baseline: three focused controller suites pass 30 tests.
- Initial three-controller suites pass all 30 tests. YAML parse and enumeration across
  2026–2027 prove nine/five weekly slots, no duplicates, and the stated gap bounds.
- Parsed workflow comparison proves every non-schedule field unchanged except the
  cadence-neutral LINQ display name; comments are non-executable.
- Parent candidate review, scoped commit, draft PR, final ReviewGPT, exact-head CI.
- Merge only after required gates; parent coordinates shared production releases.
- Verify schedules on protected main; observe natural runs without paid dispatches.

## Scope extension

Parent confirmed all scheduled canaries include Garmin and the synthetic Stripe
matrix. Update their schedules and existing cadence guards only. Stripe event
logic, sandbox assertions, and manual-ref prohibition remain unchanged. No live
provider, financial, or additional billable test dispatch is performed locally.
The original round-one review at 03eb4dfd5a75 is retained as prior-head evidence;
the expanded head requires a new exact-head review and CI.

Expanded-scope verification: all 44 Node controller tests and all 39 Stripe
workflow/provider-boundary tests pass. The actual Stripe event-result shell
boundary is exercised without provider or financial operations.

## Candidate review

Focused proof and docs drift pass. Complexity guard passes; the existing Stripe checker changes only its required
cron literal and diagnostic wording. Parent inspected the complete diff: no assertion, source pin, permission, concurrency or non-schedule trigger
changes. One Stripe failure message now describes its twice-weekly schedule. Cadence uses UTC and preserves native 30-minute staggering. Local
implementation is complete; final external review and exact-head CI remain
required before merge. Coordination note is recorded on PR #4236; its existing
owner retains all diagnostic and release work.
Completed: 2026-10-20
