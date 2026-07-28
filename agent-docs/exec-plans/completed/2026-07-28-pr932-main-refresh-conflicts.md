# PR 932 current-main conflict resolution

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Reconcile PR #932 with the latest `origin/main` without weakening the
  one-opener group-join outreach flow, exact reply recovery, current delivery
  liveness, or the newer Linq behavior already merged to `main`.

## Success criteria

- The branch contains a normal merge of current `origin/main`.
- The three observed conflicts preserve both branches' current delivery and
  webhook invariants without adding another owner, state machine, or retry
  lifecycle.
- Focused conflict-path verification and the canonical diff-aware and
  acceptance lanes pass.
- The final scoped commit is pushed, CI is green, the PR is conflict-free, and
  the manual resolution delta receives an exact-head ReviewGPT correction
  verification pass.
- The PR stays open and unmerged.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts`
  - `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
  - `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
  - Merge-generated updates from `origin/main`, this plan, its exact ledger
    row, PR metadata, verification, CI, and ReviewGPT evidence.
- Out of scope:
  - New outreach copy or a larger variation bank.
  - Reopening previously accepted ReviewGPT corrections except where current
    `main` directly affects them.
  - Merging or closing PR #932.

## Constraints

- Preserve the one automatic link-free opener and no-follow-up policy.
- Keep the current `HostedLinqDelivery.status` row as delivery-liveness
  authority.
- Resolve each conflict from both code paths and their tests; do not choose
  either side wholesale.
- Preserve unrelated working-tree and coordination-ledger work.

## Risks and mitigations

1. Risk: A conflict resolution could restore stale timestamp-based delivery
   liveness.
   Mitigation: trace every conflicted predicate through the current
   dispatch/recovery tests and retain status-owned liveness.
2. Risk: Newer main-branch Linq behavior could lose its regression proof.
   Mitigation: combine non-overlapping fixtures/assertions and run the focused
   dispatch and webhook suites before canonical verification.
3. Risk: A clean textual result could still be incompatible with the newest
   Web schema or runtime.
   Mitigation: run `pnpm test:diff apps/web` and `pnpm verify:acceptance`, then
   require green PR CI on the pushed exact head.

## Tasks

1. Inspect the base, PR, and current-main versions of all three conflicts.
2. Merge current `origin/main` normally and resolve the conflicts with the
   smallest combined result.
3. Run focused conflict-path checks and canonical verification.
4. Perform the parent final review, privacy scan, conflict-marker scan, and
   diff-shape check.
5. Close this plan through `scripts/finish-task`, push, and refresh PR metadata.
6. Run CI and the next ReviewGPT correction-verification round concurrently;
   resolve only accepted findings and finish with a conflict-free open PR.

## Decisions

- Use a normal merge rather than rewriting the already-reviewed branch
  history.
- Keep the existing 25 deterministic opener leads unchanged; this task only
  confirms their count and resolves current-main integration.

## Verification

- Merged `origin/main` normally at `676a03b20d41b7692ae5f492355171c5ae91cb6c`
  in merge commit `eb894f4798aefaaa6c388fe452e80dcddaffc983`.
- Focused conflicted-path suite: 3 files, 280 tests passed.
- Canonical Web diff verification: 556 files passed, 16 skipped; 7,271
  tests passed, 216 skipped. TypeScript, lint (zero errors), development
  smoke, and production build passed.
- PostgreSQL reply-recovery suite: 14 tests passed against the isolated task
  database after bringing its db-push schema current.
- Local acceptance found one transient `AbortError` assertion in an unchanged
  Assistant Runtime clinical-records test; the exact isolated test passed
  immediately. A second local attempt could not acquire the shared host slot
  for ten continuous minutes.
- The first documented 16-vCPU bounded-admission fallback passed every visible
  Web, Assistant Runtime, Inbox Services, and Cloudflare test, but its
  orchestrator recorded an Inbox Services coverage-step failure despite the
  output showing all 88 tests passed. The exact local Inbox Services coverage
  command then passed 13 files and 88 tests.
- The single unchanged-head infrastructure retry passed the full canonical
  acceptance composition in 6m12s on Testbox
  `tbx_01kyn3fwt54jm7d9jx2qysas77`; provider run
  `30392476127` exited successfully.
- Privacy scan, `git diff --check`, and conflict-marker scan passed.
- A merge-tree simulation against then-current `origin/main`
  (`c348b9662b17dadc950dad4c69b7d929d9a5364d`) was clean; this will be
  repeated immediately before push and handoff.
Completed: 2026-07-28
