# Drain device imports with fewer runtime restarts

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Drain large device imports with fewer checkpoint/restore cycles while preserving
  foreground delivery, bounded work, and durable continuation ownership.

## Success criteria

- A synthetic three-minute backlog completes in one pass instead of two.
- Foreground and outer cancellation still stop admission promptly.
- Five-minute and 100-job bounds still apply; unfinished jobs retain recovery.

## Scope

- In scope: existing device pass time budget, focused proof, owner documentation.
- Out of scope: source authority, import deduplication semantics, provider concurrency,
  production mutation, and deployment.

## Constraints

- Existing runtime owns cancellation and checkpoint continuation; no new state.
- Keep provider request limits, job limit, atomic writes, and cleanup cap unchanged.
- Product UX patch: faster large imports; reaches connected-device members;
  prove uninterrupted drain, foreground/reminder priority, timeout, and recovery.

## Risks and mitigations

1. Longer uncheckpointed work can increase replay after unexpected termination.
   Mitigation: retain a finite five-minute cap and existing exact continuation,
   idempotent import, foreground cancellation, and 100-job limits.

## Tasks

1. Reproduce the unnecessary interruption with a synthetic timed backlog.
2. Tune the existing pass budget from two to five minutes.
3. Run focused runtime tests, typecheck, complexity review, and documentation checks.
4. Review and commit the scoped change; report deployment separately.

## Decisions

- The existing two-minute deadline interrupts progressing backlogs and incurs
  checkpoint/restore overhead. Extend that owner instead of adding a scheduler,
  cache, parallel provider requests, or another continuation loop.
- This amortizes fixed overhead; it does not claim to eliminate duplicate imports
  or accelerate individual provider requests.

## Verification

- Focused maintenance and event tests, composed foreground/reminder/restore tests,
  assistant-runtime typecheck, and complexity diff.
- Expected: longer uninterrupted drain, identical cancellation and recovery,
  no new dependencies or persisted shapes. Production speedup remains unmeasured.

## Results

- Before the budget change, all four added synthetic long-drain cases failed:
  the old deadline admitted only four 30-second jobs.
- After the change, six jobs finish in one three-minute pass; a sustained queue
  stops at ten jobs/five minutes; foreground and outer cancellation stop at five
  jobs without admitting a sixth.
- Maintenance and event tests: 133 passed. Composed concurrent-device,
  foreground delivery, due-reminder, and restore/recovery tests: 42 passed.
- Assistant-runtime and hosted-Web typechecks passed. Changelog rendering:
  10 passed. Complexity diff passed with zero source hotspots; docs drift passed.
- Product UX: Ready for the tested local patch. No individual or group prompt,
  tool, source admission, provider concurrency, or persisted shape changes.
- Parent review found no additional state owners or dependencies. Existing
  exact continuation and cancellation paths remain unchanged.
- Changelog: longer-device-import-passes. No PR number exists for this local
  commit; fill its source attribution when opening a PR.
- Delivery boundary: scoped local commit only. No production deployment, live
  speedup claim, PR CI, or exact-pushed-head ReviewGPT evidence is claimed.
Completed: 2026-09-15
