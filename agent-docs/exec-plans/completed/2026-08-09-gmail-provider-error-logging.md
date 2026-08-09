# Gmail provider error logging

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Make failed Composio connected-app executions log the provider's documented
  structured error code/category through the existing hosted onboarding route
  logger without retaining free-form provider prose that may echo private input.
- Preserve current send, retry, ambiguity, and user-visible behavior.

## Success criteria

- HTTP error responses retain bounded documented numeric error codes and strict
  category slugs; successful HTTP envelopes with `successful: false` retain only
  the existing generic diagnostic because their error field is free-form text.
- Production route logs include the structured diagnostic while the runner
  response remains generic.
- Invalid, oversized, or differently shaped provider bodies preserve the
  current status/type behavior without adding another logging system.
- Focused tests prove useful structured diagnostics survive and arbitrary
  provider wording does not.

## Scope

- The existing Composio client error boundary and connected-app error mapping.
- Focused hosted Web tests for provider errors and route logging.
- The current connected-app security contract for sanitized failure reasons.

## Constraints

- No new state, service, logger, dependency, retry, or provider call.
- No raw provider body logging.
- No user-visible or dispatch-classification behavior change.

## Tasks

1. [x] Preserve only bounded structured provider diagnostics on existing
   Composio request errors.
2. [x] Project them through the existing sanitized onboarding route logger.
3. [x] Add focused regression coverage and run local verification.
4. [x] Complete ReviewGPT and exact candidate preparation; final-head CI,
   merge, production verification, and worktree retirement remain release
   operations after this implementation plan closes.

## Verification log

- `pnpm exec vitest run --config vitest.workspace.ts --no-coverage
  test/connected-apps-composio.test.ts test/connected-apps-email-send.test.ts`
  from `apps/web`: passed, 25 tests.
- An earlier run that also named `test/hosted-onboarding-routes.test.ts` proved the
  two focused files but timed out in that unrelated suite's dynamic-import
  `beforeAll`; the exact focused rerun above passed.
- `pnpm logs:guard`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check` plus the scoped identifier, secret-assignment, and `.env`
  diff scan: passed.
- `pnpm --dir apps/web typecheck`: passed after the same command identified and
  prompted an explicit `HostedOnboardingError` control-flow check in the test.
- `pnpm --dir apps/web typecheck:prepared`: passed on the final candidate.
- Final ReviewGPT round 1 on `72b7f530caa5` returned two accepted findings:
  free-form provider prose can echo private input, and the fixed-write wrapper
  must retain its ambiguity classification. The existing service test reproduced
  the latter failure.
- Preliminary specialist ReviewGPT returned one accepted coverage finding for
  the same service boundary plus route and unusable-body proof gaps. Its optional
  test-only patch was inspected but not applied because its service expectation
  preserved the unsafe free-form-message behavior and removed the required
  ambiguity classification; the applicable coverage is being added manually.
- Remediated focused proof on the four affected boundaries passed: 62 tests in
  `connected-apps-composio`, `connected-apps-email-send`,
  `connected-apps-service`, and `connected-apps-internal-route`.
- Remediated `pnpm --dir apps/web typecheck:prepared`, `pnpm logs:guard`,
  `pnpm docs:drift`, and `git diff --check`: passed.
- Final ReviewGPT round 2 passed with no remaining qualifying findings.
- The pre-rebase pushed candidate passed every required GitHub check, including
  release build, Web typecheck and app verification, package coverage, host
  verification, repository hygiene, viewport overflow, and Vercel deployment.
- After rebasing onto the current `main`, focused Web proof passed 88 tests
  across the four connected-app boundaries plus the two repaired verification
  gates.
- On that rebased candidate, `pnpm logs:guard`, PR-range `pnpm docs:drift`,
  `pnpm --dir apps/web test:viewport-overflow --list`, `git diff --check`, and
  the scoped identifier/credential diff scan passed. The viewport command
  selected only the intended overflow spec and listed 76 browser cases.
- Parent final review found no unresolved correctness, privacy, architecture,
  or verification issue. Final exact-head CI remains the merge gate.
Completed: 2026-08-09
