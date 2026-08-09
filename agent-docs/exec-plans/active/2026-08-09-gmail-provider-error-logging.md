# Gmail provider error logging

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Make failed Composio connected-app executions log the provider-authored error
  message through the existing hosted onboarding route logger.
- Preserve current send, retry, ambiguity, and user-visible behavior.

## Success criteria

- HTTP error responses and successful HTTP envelopes with
  `successful: false` retain a bounded provider error message.
- Production route logs include that message after the existing shared log
  sanitizer removes secrets, URLs, contact details, and paths.
- Invalid, oversized, or differently shaped provider bodies preserve the
  current status/type behavior without adding another logging system.
- Focused tests prove useful wording survives and recognizable private values
  do not.

## Scope

- The existing Composio client error boundary and connected-app error mapping.
- Focused hosted Web tests for provider errors and route logging.
- The current connected-app security contract for sanitized failure reasons.

## Constraints

- No new state, service, logger, dependency, retry, or provider call.
- No raw provider body logging.
- No user-visible or dispatch-classification behavior change.

## Tasks

1. [x] Preserve the provider error message on existing Composio request errors.
2. [x] Project it through the existing sanitized onboarding route logger.
3. [x] Add focused regression coverage and run local verification.
4. [ ] Complete ReviewGPT, CI, merge, production verification, and worktree retirement.

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
