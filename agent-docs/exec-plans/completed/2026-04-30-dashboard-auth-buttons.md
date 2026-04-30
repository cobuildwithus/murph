# Dashboard Auth Buttons

## Goal

Gate the dashboard "Chat with Murph", "Upload labs", and `/home` "Connect devices" CTAs through the existing hosted `AuthButton` flow while preserving the current authenticated destinations.

Success criteria:

- Signed-out users can click those CTAs and get the hosted auth dialog instead of a dead or direct protected action.
- Signed-in users still reach the same contact route or existing device connection route as before.
- Existing server-side contact resolution remains server-owned and does not expose user contact identifiers.
- Focused tests prove the relevant CTAs render as auth buttons.

## Scope

- `apps/web/src/components/ui/auth-button.tsx`
- `apps/web/src/components/murph/murph-contact-link.tsx`
- `apps/web/src/components/murph/murph-contact-auth-button.tsx`
- `apps/web/src/components/dashboard/sidebar-chat-action.tsx`
- `apps/web/src/components/home/onboarding-steps.tsx`
- `apps/web/src/components/home/upload-labs-action.tsx`
- Directly coupled `apps/web/test/**` coverage

## Constraints

- Preserve unrelated dirty work in this checkout.
- Do not change hosted auth completion, Privy identity rules, contact routing priority, or device-sync runtime behavior.
- Do not print or write personal identifiers, secrets, raw contact details, or env contents.
- No dependency changes.

## Verification

- Pass: focused auth CTA Vitest set:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/onboarding-steps.test.ts apps/web/test/upload-labs-action.test.tsx apps/web/test/sidebar-chat-action.test.tsx apps/web/test/auth-button.test.ts`
- Pass: `pnpm --dir apps/web typecheck`
- Pass: `git diff --check` for the touched task files.
- Pass: live `/home` desktop and mobile screenshots on the existing local dev server show the original CTA/sidebar styling restored after auth-gating.
- Blocked by unrelated dirty-tree failures: `pnpm --dir apps/web lint` fails on `apps/web/src/components/homepage/site-footer.tsx` and unused hosted-onboarding symbols outside this task.
- Blocked by unrelated dirty-tree failures: `bash scripts/workspace-verify.sh test:diff ...` reaches the web verify lane, but the web lint failure above plus existing hosted onboarding/layout/baseline test failures stop the lane.
- Commit scope: task-only hunks were staged, with unrelated overlapping dirty work left unstaged.

## Progress

- Implemented `AuthButton` support for rendered non-button elements without leaking the native `type` prop.
- Added unstyled button variants so auth gating can preserve existing CTA/sidebar styling.
- Added `MurphContactAuthButton` for server-resolved Murph contact actions.
- Gated dashboard "Chat with Murph", dashboard/home "Upload labs", and `/home` "Connect devices" with `AuthButton`.
- Updated focused tests for the auth-gated link/button surfaces.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
