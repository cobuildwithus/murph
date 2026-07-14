# PR 570 usage-action remediation recovery

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Recover the post-merge PR #570 ReviewGPT remediation onto a fresh branch based
on current `main`, preserving the old branch and shipping the web-owned usage
projection as the single source of usage-related billing actions.

## Success criteria

- The fresh branch starts from the current remote `main` head and preserves the
  old merged PR branch and commit history unchanged.
- The meaningful source/test diff from `1aa927cd` is recovered or truthfully
  reconciled with current `main` without broadening scope.
- Complete Stripe billing identifiers are required before projecting an Edge
  upgrade, and Home plus Settings render action labels and destinations only
  from the projection's `recommendedAction`.
- Routed web verification, direct UI proof, security/privacy review,
  frontend review, coverage review, and parent final review pass with no
  unresolved accepted findings.
- The scoped recovery commit is pushed to a fresh draft PR with a current
  intent contract, CI starts, and exact-head ReviewGPT starts concurrently.

## Scope

- In scope: commit `1aa927cd`, its directly affected Home/Settings usage-action
  projection and tests, the immutable recovered completed-plan snapshot, and
  PR metadata required by the completion workflow.
- Out of scope: billing mutation routes, allowance/accounting redesign,
  unrelated UI work, PR #542, and PR #573.

## Constraints

- Usage remains advisory and replies continue at 100%.
- Group usage stays unavailable and reveals no payer or shared balance.
- Internal currency values remain inside the web owner.
- Billing mutation routes retain final server-side revalidation.
- Preserve unrelated work and use only this isolated checkout.

## Tasks

1. Compare `1aa927cd` against current `main` and prove both accepted findings
   remain applicable before recovering the smallest exact patch.
2. Reconcile any conflicts without changing the remediation's owner boundary.
3. Run routed verification and direct desktop/mobile UI proof.
4. Run required security/privacy, frontend, and coverage audit passes; resolve
   accepted findings and complete the parent final review.
5. Close this plan through `scripts/finish-task`, inspect the final diff for
   privacy/scope, push guarded, open a fresh draft PR, and start ReviewGPT in
   parallel with CI.

## Verification

- Recovery equivalence: the final source patch ID is
  `fc340a44dee1b81ef5e417c741316417caf5fe70`, exactly matching the source patch
  ID from `1aa927cd`. Before the required coverage pass strengthened two test
  labels, the recovered source/test patch ID also exactly matched the stranded
  commit at `4aa9223e961eefc337558b5e17d358ddc35125e2`.
- Focused usage projection/Home/Settings coverage passed: 3 files, 47 tests.
- Diff-aware web verification passed dependency policy, workspace-boundary and
  package-cycle guards, hosted runtime guards, privacy/log guards, legal PDF,
  Prisma generation, Health Commons generation, lint (0 errors, 11 unrelated
  existing warnings), and the production Next build (188 pages generated).
- The diff-aware full web suite passed 408 files with 1 skipped and 1 timed-out
  file; 4,950 tests passed and 146 skipped. The only failure was the unrelated
  `agent-session-routes.test.ts` setup hook crossing its 60-second timeout under
  the concurrent host load. Its isolated rerun passed 1 file and 11 tests.
- The coverage worker's package wrapper expanded to the full web suite after
  the test-only refinement; that serial rerun passed 409 files with 1 skipped,
  4,961 tests passed, and 135 skipped.
- The diff-aware cold dev smoke reached Next readiness but crossed its health
  deadline while workflow discovery was still running. The repository's exact
  prepared-local smoke command passed after that cache was warm.
- Direct desktop/mobile browser inspection remains unavailable because this
  session has no browser backend. Server-rendered markup tests cover the
  changed action and action-free states; no screenshot claim is made.

## Audit resolution

- Security/privacy review found no evidence-backed medium-or-higher issue. The
  patch exposes only the bounded projection, keeps group usage unavailable,
  requires complete Stripe references before projecting an upgrade, and leaves
  billing mutation authorization and revalidation unchanged.
- Frontend review found no blocking or actionable issue. Action-free states
  stay informational, action labels and links come from `recommendedAction`,
  and responsive/accessibility patterns match the established components. The
  missing desktop/mobile render is recorded in Verification.
- Coverage review found one small stable-boundary gap: canonical fixture labels
  could not prove that Home rendered the projection's label. The worker changed
  only those two fixtures/assertions to projection-unique labels; focused
  coverage remained green at 3 files and 47 tests. Existing tests already prove
  both incomplete-Stripe-reference cases, Settings descriptor/null gating,
  neutral advisory states, and removal of the unused formatter.
- Parent final review found no unresolved issue: the four-file source patch is
  the exact owner-bound correction from the stranded remediation, the only
  later change is the coverage worker's two label assertions, the recovered
  completed-plan snapshot is byte-identical to `1aa927cd`, and no unrelated
  path, unsafe cast, compatibility layer, or new dependency entered the diff.
  The fetched `main` advance touches only the ledger plus unrelated exercise
  catalog and assistant-prompt paths; final reconciliation will be verified by
  the unchanged source patch ID before push.
Completed: 2026-07-14
