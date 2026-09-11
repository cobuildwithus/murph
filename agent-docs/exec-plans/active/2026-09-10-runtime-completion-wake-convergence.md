# Durable device completion under scheduler wakes

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Make checkpointed device work finish durably despite empty scheduler notifications, while preserving prompt foreground handoff and cancellation ownership.

## Evidence and cause

A synthetic real-snapshot regression restores a recording device item three times. An empty wake during sharing-scope discovery causes zero acknowledgments, three checkpoints, and three immediate wakes. The quiet control completes once. Existing coverage qualifies wakes only during the final completion snapshot and omits the sharing port.

## Scope and constraints

Reuse conversation mailbox qualification across the completion sequence. Preserve shutdown, fencing, cron deadlines, projection ownership, revision acknowledgment, and canonical checkpoint ordering. Use synthetic fixtures only; do not change production state or scheduler policy.

## Tasks

1. Extend wake qualification across projection discovery, delivery, browser refresh, recording, and the final checkpoint.
2. Prove convergence after real restores, bounded callbacks, and genuine conversation preemption at each relevant boundary.
3. Run focused runtime tests and typecheck; review privacy, complexity, and owner documentation.
4. Commit the scoped candidate, open a PR, and run required review concurrently with exact-head CI.

## Verification

- The new empty-wake regression fails before the fix; quiet control passes.
- All focused convergence, projection, foreground handoff, shutdown, and checkpoint tests must pass after the fix.
- Runtime typecheck and complexity guard must pass.
- The existing required platform-a CI test glob must include the new regression.

## Risks

A consumed wake can race with stage completion. Preserve the qualified notification and prefetched conversation batch through disposal, and verify real input arriving after an empty wake.

## Candidate review

The correction reuses the existing wake and prefetch owners without changing persisted schemas. Completed work must survive empty hints at all seven boundaries; real inputs retain prompt handoff. Blocked assistant invocations preserve observed owner authority because they cannot inspect conversation input. Tests now enqueue actual foreground rows in projection/acknowledgment preemption fixtures.

Runtime and Web typechecks, the changelog page tests (10 cases), and the complexity guard pass. Final focused runtime verification passes: 72 tests across five files, including all 15 new convergence/preemption cases. Required CI and ReviewGPT remain pending on the pushed candidate.

## Product UX

Patch; local journeys Ready. No member action or prompt changes. Quiet completion, empty scheduler bursts, real conversation preemption, projection failure/recovery, shutdown, and blocked-assistant handoff were replayed through their existing owners. Publication/callback ports use synthetic responses; real snapshots persist handling progress. Production release convergence remains an operational check after deployment.

## Delivery

Draft PR #3226 contains the candidate. Its existing wearable-import changelog item now includes this PR. Required exact-head CI and final ReviewGPT remain open completion gates.
