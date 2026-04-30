# Redirect hosted signup success to home after activation

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- After hosted signup checkout returns to `/join/[inviteCode]/success`, send the user to `/home` once the invite status proves the account is active. Do not redirect while checkout/webhook activation is still pending or when the invite is invalid/blocked.

## Success criteria

- `/join/[inviteCode]/success` reconciles the returned Stripe Checkout session as before.
- When the status becomes authenticated `active`, the client replaces the success page with `/home` so the browser back stack does not strand the user on the success page.
- Pending, verify, blocked, expired, invalid, and preview states remain on the success page.
- Focused client tests cover initial active status and post-reconciliation active status.

## Scope

- In scope: hosted onboarding success page/client behavior and directly coupled tests.
- Out of scope: Stripe webhook reconciliation semantics, billing state writes, dashboard auth policy, and broad onboarding copy/layout changes.

## Constraints

- Technical constraints: Stripe Checkout success is not entitlement authority; redirect only after status reaches `active`. Use the existing client polling/reconciliation state instead of adding new persisted state.
- Product/process constraints: preserve unrelated dirty work and active ledger rows; run required hosted-web checks/audits for a payment/onboarding UI behavior change.

## Risks and mitigations

1. Risk: redirecting before the webhook/member activation path succeeds.
   Mitigation: gate redirect on `stage === "active"` plus authenticated matching invite session.
2. Risk: breaking preview or troubleshooting states.
   Mitigation: disable automatic redirect in preview and preserve pending/error support UI.

## Tasks

1. Done: inspected current success page, billing success route, invite-status lifecycle, and tests.
2. Done: updated the success client to redirect to `/home` only after confirmed active status.
3. Done: updated focused tests for initial-active, reconciliation-to-active, failed-reconciliation-active, preview, and mismatched-session guard flows.
4. Done: ran focused hosted-web tests/typecheck plus required completion audits.
5. Next: close the plan and commit only the scoped changed files.

## Decisions

- Use client-side `window.location.replace("/home")` for the final redirect so `/join/.../success` is not kept in browser history after activation.

## Verification

- Passed: `pnpm exec vitest run apps/web/test/join-invite-success-client.test.ts --config apps/web/vitest.config.ts --no-coverage` (12 tests).
- Passed: `pnpm --dir apps/web exec eslint src/components/hosted-onboarding/join-invite-success-client.tsx test/join-invite-success-client.test.ts`.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `git diff --check -- apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx apps/web/test/join-invite-success-client.test.ts agent-docs/exec-plans/active/2026-04-30-join-success-home-redirect.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Blocked unrelated: `bash scripts/workspace-verify.sh test:diff apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx apps/web/test/join-invite-success-client.test.ts` fails inside `apps/web verify` on pre-existing unrelated lint/test/build issues outside this diff.
- Required audit passes: security/privacy review found no issues; frontend review and task-finish follow-ups found redirect guard gaps that were fixed; final follow-up review found no remaining findings.
Completed: 2026-04-30
