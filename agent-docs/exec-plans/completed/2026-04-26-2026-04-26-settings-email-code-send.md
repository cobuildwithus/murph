# Fix settings email code send

Status: completed
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Fix `/settings` hosted email verification so clicking “Send code” for an unlinked email address starts a real Privy email OTP request before opening the verification dialog.
- Preserve the existing update-email behavior for users who already have a verified Privy email.

## Success criteria

- Add-email settings flow uses the supported Privy email OTP login/link flow instead of the update-email-only hook.
- Update-email settings flow continues to use Privy’s update-email OTP flow.
- Regression tests cover both first-time email linking and changing an existing email.
- Scoped tests, typecheck, lint, and required completion reviews are run before handoff.

## Scope

- In scope: hosted settings email controller/components and directly coupled settings email tests.
- Out of scope: Telegram linking, hosted onboarding email auth, backend sync route semantics unless the frontend fix proves a server issue.

## Constraints

- Technical constraints: keep Privy flows on supported SDK hooks; do not add new dependencies; avoid `any` casts.
- Product/process constraints: preserve unrelated dirty work; do not expose real contact identifiers, secrets, local user paths, or legal names in code, docs, logs, or fixtures.

## Risks and mitigations

1. Risk: using an auth login hook could unintentionally authenticate instead of link.
   Mitigation: verify SDK behavior and only use the link-capable flow when the user has no existing email; keep update flow for existing email addresses.
2. Risk: the current update hook swallows send/verify errors.
   Mitigation: add explicit flow selection and test the no-existing-email regression that caused the no-network symptom.

## Tasks

1. Trace settings email and Telegram linking flows.
2. Patch settings email send/verify flow selection.
3. Add focused regression tests.
4. Run scoped verification and required completion reviews.

## Decisions

- The settings add-email path must not call `useUpdateEmail`; Privy’s update-email hook requires an existing `user.email` and silently reports the missing-email error through hook state/callbacks.
- First-time email linking now uses Privy’s public link-account flow, matching the supported modal-based approach used by Telegram. The custom OTP dialog remains for changing an already-linked email.
- Existing-email update sends now treat Privy `useUpdateEmail` `onError` callbacks as failed sends/verifications instead of opening the local dialog after a swallowed SDK error.
- Both resend entry points now read the visible email field instead of falling back to a stale pending email address.

## Verification

- Commands to run:
  - `pnpm --dir apps/web exec vitest run test/settings-email-settings.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint`
  - Browser/UI verification if the app can run with available local configuration.
- Expected outcomes: focused tests, typecheck, and lint pass; browser verification either passes or any environment blocker is recorded.
- Results:
  - `pnpm exec vitest run apps/web/test/settings-email-settings.test.ts --config apps/web/vitest.config.ts --no-coverage` passed with 9 tests.
  - `pnpm --dir apps/web lint` completed with existing warnings outside the settings email diff.
  - `pnpm --dir apps/web typecheck` is blocked by unrelated active Health Commons/hosted-web type drift outside the settings email diff, most recently `test/health-commons-biomarker-detail-page.test.ts` importing a missing biomarker-detail redirect helper.
  - `bash scripts/workspace-verify.sh test:diff ...settings email files...` is blocked by unrelated active hosted-onboarding/schema/test drift around `pendingActivationTimeZone` plus unrelated Health Commons/experiment-detail type drift.
  - Desktop/mobile browser screenshots against local `/settings` are blocked in this environment because the route returns 500 before rendering when `DATABASE_URL` is unset.
  - Required reviews: security/privacy review reported no findings; coverage-write added focused settings email assertions; frontend review found the stale dialog resend path and the fix is now covered by test; task-finish review findings for verify-error coverage and ledger scope were addressed.
Completed: 2026-04-26
