# Connect Link Auth Resume Plan

Created: 2026-06-05

## Goal

Opening a hosted device connect link while unauthenticated should present the
normal auth dialog by default, then continue the original device-connect intent
after the user authenticates when the intent is still valid and belongs to that
member.

Success criteria:

- An unauthenticated first-party connect URL preserves its claim/intent across
  auth instead of rendering a dead or silent page.
- After auth, the page resumes the same connect flow and starts provider OAuth
  only through the existing authenticated POST path.
- Expired, consumed, or wrong-member intents still fail closed.
- The behavior is covered by focused hosted-web tests.

## Constraints

- Do not expose raw provider URLs or provider tokens to the browser.
- Do not start provider OAuth from an unauthenticated GET.
- Keep `apps/web` as the hosted device-sync control-plane owner.
- Keep the change narrow; avoid new persisted state unless current routing
  state is insufficient.

## Working Set

- `apps/web/app/(dashboard)/connect/page.tsx`
- `apps/web/app/(dashboard)/connect/connect-page-client.tsx`
- `apps/web/app/device/connect/[claim]/route.ts`
- `apps/web/src/components/hosted-onboarding/auth-dialog-provider.tsx`
- `apps/web/test/auth-dialog-provider.test.tsx`
- `apps/web/test/connect-page.test.ts`

## Verification Plan

- Use focused hosted-web tests first.
- Run the required `apps/web` verification lane or truthful `pnpm test:diff`
  scope after implementation.
- Run the required security/privacy, frontend, coverage, and final completion
  audits before handoff.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
