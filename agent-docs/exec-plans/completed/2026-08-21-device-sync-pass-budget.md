# Increase the hosted device-sync pass budget

Status: completed
Created: 2026-08-21
Updated: 2026-08-22

## Goal

- Give model-free hosted device-sync work enough time to drain more queued jobs
  per admitted pass without lengthening shared Web/checkpoint request deadlines.
- Preserve prompt foreground preemption and the existing durable retry and
  checkpoint handoff added by PR #2106.

## Success criteria

- Explicit device-sync mailbox wakes and idle device reconciles both use a
  90-second pass budget.
- The shared hosted runtime commit timeout remains unchanged.
- Fresh foreground work and invocation aborts remain wired to end resumable
  device work at cooperative boundaries before the pass budget expires.
- Focused tests, package typecheck, required review gates (including the
  prescribed local fallback if the external gate is unavailable), exact-head
  CI, and current-base mergeability complete with no accepted finding unresolved.

## Scope

- The hosted assistant runtime's device-sync maintenance admission paths.
- Focused call-boundary tests and the durable hosted-runtime protocol.
- The existing related public changelog item.

## Product UX

- Outcome: Established members with delayed connected-health work get a longer
  bounded opportunity to make progress through the existing background-sync
  journey.
- Reaches: Explicit device mailbox wakes and idle scheduled reconciles; no new
  surface, audience, data source, or permission.
- Proof: Both production entry paths receive the 90-second budget in focused
  tests, while foreground and abort propagation remain intact and atomic
  dense-raw cleanup retains its prior 45-second admission cap.
- Walkthrough: Ready. Queued work gets a longer bounded pass, foreground input
  still preempts it at existing cooperative boundaries, and partial work retains
  the existing durable continuation.

## Constraints

- Do not add another scheduler, retry owner, environment variable, or persisted
  state seam.
- Do not change the 45-second shared Web/checkpoint request timeout.
- Keep device maintenance lazy-loaded from foreground runtime code.
- Keep atomic dense-raw cleanup on its prior 45-second admission cap; the
  longer device-pass budget is for resumable sync progress.

## Tasks

1. [x] Trace the deployed timeout, foreground-yield, and checkpoint ownership
   boundaries on current `main` after PR #2106.
2. [x] Add one lightweight 90-second device-pass limit and apply it to both
   device entry paths.
3. [x] Add focused regression assertions and update the runtime protocol.
4. [x] Commit and push an exact candidate, open the PR, and start required
   ReviewGPT passes concurrently with exact-head CI.
5. [x] Resolve findings, complete parent review, close this plan through
   `scripts/finish-task`, and prove current-base mergeability.

## Verification log

- `pnpm --dir packages/assistant-runtime typecheck` passes.
- The corrected three-suite hosted runtime regression passes: 3 files and 412
  tests.
- The corrected full assistant-runtime suite passes: 90 files and 2,470 tests,
  with five intentionally skipped tests and one intentionally skipped file.
- Changelog generation and its focused fragment suite pass: 1 file and 7 tests.
- The PR changelog guard passes all 14 tests. Two initial focused Vitest
  invocations used an app-relative filter from the app working directory and
  selected no files; the corrected repository-root invocation passed all seven
  fragment tests.
- The preliminary external specialist review required narrowing the outcome
  from guaranteed faster catch-up to a longer bounded opportunity; the plan,
  protocol, and changelog now use that proven claim.
- The external final-review wrapper became unrecoverable before returning an
  answer. The prescribed local deep-review fallback found two accepted gaps:
  explicit wakes could schedule activity automation after a yielded sync, and
  the longer pass could enlarge atomic dense-raw cleanup exposure. The explicit
  path now mirrors the idle skip/signal fence, and cleanup keeps its prior
  pass-relative 45-second admission window. Targeted final validation reports
  no remaining code or test finding.
- The optional diff verifier repeated the same full owner-package pass, then
  was stopped at an unrelated shared-host app-slot wait. Before that wait it
  reported two existing workspace-boundary violations in untouched test files.
- Parent final review found no remaining defect or proof gap. The corrected-head
  Product UX replay is `Ready`: the demonstrated promise remains a longer
  bounded background opportunity with cooperative foreground priority, not
  guaranteed freshness or catch-up.
- Exact candidate CI passed package coverage, build/typecheck, runner-bundle,
  CLI, changelog-policy, repository-hygiene, viewport, billing-boundary, and
  pull-request-evidence checks. The required release aggregate remains red only
  because current `main` added
  `appendHostedMailboxEnvelopeWithIdentityTx` to the shared hosted Web testkit
  without adding that export to
  `apps/web/test/hosted-web-testkit-group-email.test.ts`'s module mock. The
  introducing PR's release-app check failed too, this PR does not change the
  test, testkit, or mailbox store, and the one-test local reproducer fails with
  the same missing-mock-export error.
- Exact candidate hosted-native iOS E2E passed. Hosted-native Android reached
  the Health Connect handoff, then failed at the permission-state stage before
  exercising this PR's device-maintenance path; other PR-mode runs on the same
  pinned Android build fail at the identical stage.
- The branch contains the fetched current base, and the current-base merge-tree
  is conflict-free. The final plan-only head still requires the normal pushed
  check observation before handoff.
Completed: 2026-08-22
