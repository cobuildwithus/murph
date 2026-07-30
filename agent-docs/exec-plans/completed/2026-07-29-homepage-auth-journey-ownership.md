# Collapse homepage auth journey ownership

Status: completed
Created: 2026-07-29
Updated: 2026-07-29
Review source: PR #1127 final ReviewGPT round 2

## Goal

- Guarantee that one provider attempt owns a homepage signup journey from
  provider initiation through consent presentation or navigation handoff.
- Keep that winning provider's initiating action visibly busy until the next
  UI or destination owns the experience.

## Success criteria

- Phone, email, and Telegram cannot overlap provider authentication within one
  mounted homepage auth journey.
- A provider result that did not acquire journey ownership cannot reach account
  completion or create a competing session.
- The winning action stays mounted and busy through consent commit or redirect
  handoff.
- Failure releases journey ownership and restores the same method's recovery
  state.
- Production-faithful tests cover opposing provider resolution order, consent,
  decline, retry, and redirect-return behavior.
- Focused tests, typecheck, frontend proof, exact-head review, and CI pass.

## Retrospective

- Original requirement: replace the mismatched setup/skeleton transitions with
  the real consent card and an in-place loading state on the action the person
  chose.
- First-reviewed source shape: 292 additions and 118 deletions.
- Round-two source shape: 406 additions and 156 deletions; remediation added
  114 and deleted 38 source lines.
- Repeated mechanism: the first remediation delegated phone finalization to the
  shared completion hook but left provider initiation and provider awaits owned
  by separate child components. A completion-time interaction gate could stop
  new input but could not invalidate provider work already in flight.
- Decision: redesign by shrinking ownership. The panel's existing shared auth
  completion owner will acquire one journey before provider initiation and hold
  it through the visible terminal. Child-local completion coordination added by
  the previous remediation will be deleted where the panel owns the journey.
  Overlapping provider attempts are prohibited rather than reconciled.
- Continuation rationale: this stays inside the original homepage auth surface,
  removes duplicate owner concepts, and directly protects the account/session
  completion effect required by the user-visible flow.

## Tasks

1. Record this retrospective in the PR and identify every provider-initiation
   path reachable from the panel.
2. Move journey acquisition and release into one existing panel-owned boundary.
3. Delete child-local coordination that duplicates that boundary.
4. Add opposing-resolution and visible-terminal regression coverage.
5. Run scoped verification, product review, browser proof, final ReviewGPT, and
   exact-head CI.

## Constraints

- Do not add durable state, a new service, queue, reconciliation path, or
  compatibility mechanism.
- Preserve standalone phone linking and invite behavior outside the homepage
  panel.
- Preserve account-conflict and retry recovery.
- Keep the consent and destination routing contracts unchanged.

## Verification

- Passed: four focused hosted-web Vitest files, 126 tests.
- Passed: eight representative shared-caller Vitest files, 80 tests.
- Passed: `pnpm --dir apps/web typecheck:prepared`.
- Passed: scoped hosted-web ESLint and `git diff --check`.
- Passed: desktop and mobile `/design?tab=components` browser proof using the
  production completion and consent presentations.
- Passed: exact-diff product-experience review after resolving its phone-start
  ownership finding.

Completed: 2026-07-29
Completed: 2026-07-29
