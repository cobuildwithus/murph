# Hosted Onboarding Passkey Audit

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Audit the hosted onboarding WebAuthn implementation in `apps/web` and fix any correctness/security mismatches against the current `webauthx` flow and repo docs.

## Success criteria

- Registration and authentication challenges are single-use even when verification fails.
- Successful registration/authentication rotates the hosted session and invalidates older active sessions for the same member.
- Hosted passkey ceremony responses explicitly disable caching.
- Focused tests cover the corrected lifecycle behavior.

## Scope

- In scope:
  - hosted onboarding passkey/session/http helpers
  - hosted onboarding passkey route behavior
  - focused hosted onboarding tests
- Out of scope:
  - broader hosted onboarding UX changes
  - non-passkey hosted control-plane refactors
  - billing or Linq behavior changes unless directly required by the auth fix

## Risks and mitigations

1. Risk: session-rotation changes could break the current invite handoff.
   Mitigation: keep the change at the session-record layer and preserve the existing cookie contract.
2. Risk: challenge-consumption changes could turn recoverable passkey failures into confusing dead ends.
   Mitigation: keep the current reload-and-retry UX, and cover failed-verification plus expired-challenge paths in tests.
3. Risk: this overlaps active `apps/web` work.
   Mitigation: keep the diff narrow, read current file state first, and avoid unrelated hosted route rewrites.

## Tasks

1. Confirm current passkey/session lifecycle against the installed `webauthx` API and repo docs.
2. Patch challenge consumption, session revocation, and response cache headers where the audit proves gaps.
3. Add focused regressions for the corrected behavior.
4. Run required checks plus the completion audit passes and commit the touched files.

## Outcome

- Consumed hosted passkey challenges on first verification attempt instead of only after successful verification, so failed registration/authentication now forces a fresh ceremony.
- Rotated hosted sessions by revoking older active session records on successful auth and revoking the current session record on logout.
- Marked hosted onboarding JSON responses as `Cache-Control: no-store` and added focused session/route/passkey regression coverage.

## Verification

- Passed: `pnpm review:gpt --preset simplify --dry-run`
- Passed: `pnpm review:gpt --preset test-coverage-audit --dry-run --no-zip`
- Passed: `pnpm review:gpt --preset task-finish-review --dry-run --no-zip`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-passkeys.test.ts apps/web/test/hosted-onboarding-service-passkeys.test.ts apps/web/test/hosted-onboarding-session.test.ts apps/web/test/hosted-onboarding-routes.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm --dir apps/web test`
- Passed: `pnpm test`
- Passed: `pnpm test:coverage`
- Failed outside this slice on the final rerun: `pnpm typecheck` due concurrent unrelated `packages/parsers/src/{inboxd/bridge,inboxd/pipeline,pipelines/worker,service}.ts` errors against `packages/inboxd/dist/index.d.ts`; this hosted passkey audit did not touch `packages/parsers/**` or `packages/inboxd/**`

Completed: 2026-03-26
