## Title

Hard-cut dead hosted-web UI duplicates and finish invite phone-auth controller cleanup.

## Goal

Land the last two cleanup items from the review follow-up:

1. Remove the dead duplicate top-level UI root under `apps/web/components/ui` once usage proves `@/components/ui/*` is no longer imported.
2. Finish the hosted invite phone-auth cleanup so `HostedInvitePhoneAuth` delegates invite send-code orchestration to `useHostedPhoneAuthController` instead of driving raw pending/error/reset behavior itself.

## Scope

- `apps/web/components/ui/**`
- `apps/web/src/components/hosted-onboarding/{hosted-phone-auth-controller,hosted-invite-phone-auth,hosted-phone-auth-support}.ts*`
- focused `apps/web/test/{hosted-phone-auth,hosted-phone-auth-support}.test.ts`

## Constraints

- Preserve unrelated dirty-tree edits already in flight in hosted onboarding/settings.
- Do not broaden into non-UI business logic or general design-system restyling.
- Delete the top-level UI root only if repo-wide import checks show `@/components/ui/*` is unused.

## Verification

- passed: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`
- passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-phone-auth-support.test.ts`
- passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-phone-auth-support.test.ts apps/web/test/hosted-existing-account-sign-in-dialog.test.ts apps/web/test/settings-email-settings.test.ts apps/web/test/settings-button.test.ts apps/web/test/settings-input.test.ts apps/web/test/lp-auth-controls.test.tsx`
- passed: `git diff --check -- apps/web/components/ui apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts apps/web/src/components/hosted-onboarding/hosted-invite-phone-auth.tsx apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-phone-auth-support.test.ts`

## Notes

- Current repo-wide search shows callers already import `@/src/components/ui/*`; the remaining top-level root appears to be dead duplication.
- The hosted phone-auth controller refactor is already partially present in the local worktree and needs validation/landing rather than a fresh rewrite.
- The duplicate top-level UI root was deleted and committed separately as `676e01b7` while this plan was active.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
