# Throttle native E2E to six-hour main cadence

Status: completed
Created: 2026-08-27
Updated: 2026-08-28

## Goal

- Stop native iOS and Android hosted E2E from running after every pull-request
  hygiene completion and production deployment. Run each production canary at
  most once per six-hour slot after `main` advances, while preserving exact
  production/source binding and a cheap no-change path.

## Success criteria

- The two native controller workflows have no `workflow_run` or
  `deployment_status` admission and publish no pull-request commit status.
- iOS and Android each have one fixed six-hour schedule, staggered to avoid a
  simultaneous dispatch burst.
- A scheduled controller skips paid native work only when its latest completed
  scheduled outcome succeeded at the current protected-`main` SHA.
- A failed scheduled canary retries in the next six-hour slot, while an
  explicit rerun can retry the same SHA immediately.
- Production canaries retain protected-main ancestry proof, immutable native
  source binding, bounded timeouts, environment separation, and non-canceling
  single-platform concurrency. They dispatch the current production alias SHA;
  alias lag is accepted only for a classifier-proven dated-release-note diff.
- Focused native workflow tests, repository workflow guards, and relevant
  typechecks pass; owner docs describe the new cadence and recovery path.
- The exact pushed PR head passes the required specialist/final review and CI
  gates before the disabled production controllers are re-enabled.

## Scope

- In scope:
  - Clear existing native controller/companion backlog and stop new admissions.
  - Simplify both main-repository native workflow files to scheduled production
    canaries with change detection.
  - Remove obsolete pull-request workflow assertions and the shared PR retry
    helper that exists only to recreate those workflow waiters.
  - Delete the unreachable PR lifecycle, candidate-deployment, destructive
    identity-reset modules, and their provider-boundary exceptions.
  - Move reviewed native source refs and SHAs from mutable environment variables
    into one protected-main controller policy.
  - Update deterministic workflow tests and current reliability/verification
    owner docs.
- Out of scope:
  - Private iOS or Android application/test implementation changes.
  - Branch-protection changes; native statuses are not required today.
  - Private iOS or Android workflow input compatibility changes.

## Constraints

- Technical constraints:
  - Secret-bearing workflow code must execute only from protected `main`.
  - GitHub schedule events run from the default branch; no branch-selectable
    `workflow_dispatch` entrypoint will be added.
  - Change detection must fail closed and use existing GitHub Actions history,
    not new persisted state or a long-lived delay runner.
  - A production alias behind admitted `main` may dispatch only when the existing
    Vercel classifier proves the intervening diff is runtime-inert release notes.
- Product/process constraints:
  - This is internal operational behavior, so Product UX does not apply.
  - Preserve unrelated checkout changes and use the worktree/PR lane.
  - Keep the controllers disabled until the reviewed scheduled workflow is on
    `main`, then re-enable both and verify their active state.

## Risks and mitigations

1. Risk: A schedule lands before the newest runtime-bearing `main` deployment
   reaches the production alias.
   Mitigation: Fail before private dispatch unless the complete alias-to-main
   diff passes the existing release-note-only classifier; failures retry.
2. Risk: A no-change gate accidentally suppresses an untested revision or masks
   a failed rerun.
   Mitigation: Inspect the latest completed scheduled outcome, skip only a
   same-SHA success, and fail malformed GitHub history instead of guessing.
3. Risk: A manual dispatch from an untrusted ref exposes protected credentials.
   Mitigation: Do not add `workflow_dispatch`; operator recovery uses GitHub's
   rerun of an existing trusted scheduled run.
4. Risk: Removing PR controllers leaves branch protection waiting on native
   statuses.
   Mitigation: Live ruleset inspection proves neither native status is required,
   and deterministic docs/tests will stop advertising them as PR checks.
5. Risk: Existing queued runs continue spending while the PR is reviewed.
   Mitigation: Cancel all exact native runs possible and temporarily disable the
   two main controller workflows; record the small set of GitHub zero-job zombie
   records that the platform refuses to cancel or delete.

## Tasks

1. Capture aggregate live-run evidence, clear the exact native backlog, and
   disable only the two main native controllers.
2. Rewrite iOS and Android workflows around staggered six-hour schedules, a
   protected-main change gate, and their existing production canary jobs.
3. Delete obsolete PR retry and destructive PR lifecycle ownership; commit
   exact native source pins in the protected-main controller policy.
4. Update reliability, verification, testing-map, and Android operations docs.
5. Run focused Node tests, affected package tests/typechecks, workflow syntax
   proof, privacy review, and a parent diff review.
6. Commit/push a draft PR, run preliminary specialist and final ReviewGPT in
   parallel with exact-head CI, disposition findings, and remediate accepted
   issues.
7. Close the plan with the final scoped commit, prove current-base mergeability,
   merge through the authorized PR path when all gates pass, re-enable both
   controllers, and retire the worktree.

## Decisions

- Use separate staggered schedules (`17` and `47` minutes past each six-hour
  boundary) so platforms keep independent protected environments and failure
  visibility without dispatching simultaneously.
- Treat the latest completed scheduled run's conclusion and `head_sha` as the
  no-change checkpoint. This reuses GitHub's existing durable run history,
  retries after the latest failure, and adds no new state owner.
- Keep retry semantics simple: failed scheduled work retries at the next slot;
  an operator can rerun the same trusted schedule attempt immediately.
- Store both private native source pins in
  `.github/native-hosted-e2e-controller.json`, matching the existing Temporal
  controller pattern. The checkpoint SHA now also versions source rotation.
- Preserve private companion input compatibility while deleting every public
  PR-mode caller, branch, destructive lifecycle owner, and stale doc.
- Reuse `classifyCurrentVercelBuild` for runtime-inert alias lag and dispatch the
  actual production alias SHA; add no second classifier or persistence layer.

## Verification

- Commands to run:
  - `node --test scripts/native-ios-hosted-e2e.test.mjs`
  - `node --test scripts/native-android-hosted-e2e.test.mjs`
  - The narrow package test that owns release-workflow cache assertions if its
    registry changes.
  - Repository workflow/YAML and affected typecheck commands selected from the
    verification map after the diff is final.
  - Required exact-head GitHub Actions plus preliminary specialist and final
    ReviewGPT gates.
- Expected outcomes:
  - Deterministic tests prove six-hour schedules, fixed concurrency,
    latest-outcome checkpointing, rerun behavior, committed source identity,
    release-note-only alias lag, canary-only public orchestration, and unchanged
    private dispatch/privacy boundaries.
  - The PR head is green, review findings are resolved, and both controllers
    are active only after the scheduled version lands on `main`.

## Outcome

- Cleared every actionable native controller and companion run; the remaining
  GitHub records are zero-job platform tombstones that GitHub refuses to cancel,
  force-cancel, or delete.
- Replaced per-merge and per-deployment admission with staggered six-hour
  schedules that run only after protected `main` changes, retry failures, and
  reuse the latest same-SHA success without paid work.
- Deleted the unused pull-request candidate lifecycle, destructive identity
  reset path, and mutable source-pin configuration. The resulting patch removes
  4,517 lines while adding 1,022 lines, including tests and owner docs.
- Focused native tests passed (24/24), repository policy tests passed (34/34),
  workflow lint and diff checks passed, and the final full ReviewGPT audit
  returned `ROUND_OUTCOME: PASS` with no qualifying findings.
- The reviewed patch remained byte-for-byte unchanged across the conflict-free
  `main` refresh. Required exact-head CI, merge, controller re-enablement, and
  clean worktree retirement remain operational completion steps outside the
  implementation record.
Completed: 2026-08-28
