# Unified Hosted Auth Modal

## Goal

Keep the hosted homepage auth modal behavior unified: login and signup CTAs may have different labels/copy, but they must use the same Privy signup-capable auth flow.

Success criteria:

- Homepage/login/signup modal entrypoints no longer pass a no-signup mode into hosted auth methods.
- Email OTP send failures are not hidden by a modal-level login mode.
- Focused hosted auth tests cover that split CTAs still open the same behavioral auth flow.

## Constraints

- Do not inspect or print secret `.env` values.
- Preserve unrelated dirty working-tree changes.
- Keep the change scoped to `apps/web` hosted auth modal wiring and focused tests.

## Approach

1. Remove `authMode` behavioral plumbing from `AuthDialog` and `HostedAuthPanel`.
2. Keep CTA labels/dialog copy as presentation only.
3. Update tests that asserted no-signup behavior at the modal level.
4. Run focused hosted-web auth tests plus required scoped checks.

## Verification

Completed:

- `pnpm exec vitest run apps/web/test/hosted-auth-panel.test.ts apps/web/test/lp-auth-controls.test.tsx apps/web/test/homepage-email-auth-button.test.tsx --config apps/web/vitest.workspace.ts --no-coverage`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/auth-controls.tsx apps/web/src/components/hosted-onboarding/auth-dialog.tsx apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx apps/web/test/hosted-auth-panel.test.ts apps/web/test/lp-auth-controls.test.tsx`
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
