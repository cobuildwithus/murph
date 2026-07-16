# PR 712 ReviewGPT round 3 correction

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Close the accepted ReviewGPT purpose-disclosure and coverage gap for the
  detached Assistant Ask retry path without changing production behavior.

## Scope

- Add one assertion-only detached Assistant Ask test proving secret-, URL-,
  path-, and member-shaped execution failure text is redacted before durable
  mailbox requeue.
- Expand the PR body to name detached request execution and completion
  continuation under the existing system-mailbox redaction surface.
- Push the correction, run focused verification and coverage review, then take
  the new exact head through ReviewGPT and CI before merge.

## Constraints

- No production code, new state, dependency, compatibility path, or runtime
  behavior change.
- Preserve the shared hosted-execution redaction owner and current mailbox
  claim/requeue semantics.

## Tasks

1. [x] Add the production-faithful detached Assistant Ask persistence assertion.
2. [x] Run the focused detached-ask and hosted-execution owner suites plus required
   diff guards and coverage review.
3. [x] Update the PR disclosure and prepare the scoped correction commit.

After this implementation plan is archived, push the correction, rerun
exact-head ReviewGPT concurrently with CI, and merge only when the new head is
fully green.

## Verification

- Passed the focused detached Assistant Ask and hosted-execution exact-output
  observability suites: 33 tests.
- Passed diff-aware dependency, boundary, stale-name, Temporal, crypto, and raw
  health-log guards; assistant-runtime typecheck and 1,735 tests; and the
  Cloudflare reverse-dependent verify with 1,831 tests.
- Coverage-write confirmed the test exercises the real claim, failure, and
  durable requeue path and leaves no meaningful coverage gap.
- The PR body now names detached Assistant Ask request execution and completion
  continuation plus the durable privacy rationale and mapped test proof.
- Passed `git diff --check`; exact-head ReviewGPT, required CI, and final clean
  mergeability proof remain PR-lane gates after plan archive.
Completed: 2026-07-16
