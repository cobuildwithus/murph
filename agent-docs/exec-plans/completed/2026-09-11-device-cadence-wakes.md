# Keep hosted device cadence with the scheduled reconciler

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and ownership

The global scheduled reconciler owns ordinary provider cadence and its connection-specific mailbox handoff. Hosted runtime wakes belong to unfinished jobs, dirty acknowledgements, completion barriers, and retention work. A completed refresh must publish its next cadence to Web without scheduling a second connectionless runtime pass.

## Evidence and implementation

A synthetic timer recovery reproduces a connectionless reconcile wake that cannot resolve an account or drain jobs. Future provider cadence currently escapes through both service/store wake projection and completion publication. Remove those projections at their existing owners; retain the daemon's provider scheduling and the existing compatibility recovery for already-published wakes. Add no state, queue, dependencies, or diagnostic schema.

## Protected paths and proof

- Ordinary scheduled refresh: persist cadence, complete the mailbox owner, return no runtime wake for cadence alone.
- Pending job: preserve its exact retry time even when provider cadence is earlier.
- Interrupted completion: preserve epoch/version checks and retry ownership.
- Cleanup and dirty work: preserve independent continuations and checkpoint barriers.
- Mixed versions: old timers may drain once; new code must not republish cadence. No Web or persisted schema change.

## Tasks

1. Strengthen store, pass, and composed mailbox completion regressions; observe failure before the fix.
2. Remove provider cadence from hosted runtime wake results and document the owner contract.
3. Run focused suites, package typecheck, complexity guard, and parent review; close with a scoped local commit.

## Product UX and scope

Internal scheduling efficiency only. Existing device refresh timing, import authority, foreground priority, and replies remain with their current owners. No changelog entry: no new member-visible behavior. No production mutation or deployment is part of this local fix.

## Verification

- Before implementation, four focused regressions failed on the duplicate provider-cadence wake: SQLite projection, completed pass without jobs, retry later than cadence, and checkpoint completion.
- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage` with `hosted-runtime-maintenance.test.ts`, `hosted-runtime-system-mailbox-notification.test.ts`, and `hosted-device-sync-runtime.test.ts`: the initial full run passed 398 tests and identified the migration retry dependency plus one remaining cadence expectation. Both were corrected.
- Maintenance, mailbox-state, and mailbox-notification full suites then passed 308 tests. The added two-case completion/maintenance composition regression also passed; the final maintenance suite passed all 115 tests after signal normalization. The 129 hosted-device-sync-runtime tests passed unchanged.
- The focused workspace preemption scenario `foreground wake interrupts system projection without starving a failed scope` passed, including the renamed maintenance setter.
- `pnpm --dir packages/assistant-runtime typecheck`: passed on the final source.
- `pnpm complexity:diff --base HEAD`: passed; maintenance complexity debt and maximum function complexity each decreased by six. Existing unrelated hotspots remain unchanged.
- `git diff --check`: passed. The protocol owner and index describe the scheduling boundary.

## Final review and delivery

The final source removes cadence projection and redundant return data. Completion still publishes Web cadence behind its existing epoch/version fence; real retries and dirty acknowledgements retain their existing owners. Fitbit migration retries now return an explicit deadline to the existing maintenance mailbox successor, preserving that work across completion instead of rewriting provider cadence. The setter was renamed without changing its persisted mailbox identity. Its existing snapshot/restore and successor tests remain valid. No replacement abstraction, dependency, or persisted schema was introduced.

Parent review checked the complete diff, retry and supersession paths, dormant legacy timers, privacy, and source/test scope. This task delivers a local scoped commit; PR CI, external PR review, production deployment, and post-deploy measurement are outside this local delivery. No new repository friction entry was needed.
Completed: 2026-09-11
