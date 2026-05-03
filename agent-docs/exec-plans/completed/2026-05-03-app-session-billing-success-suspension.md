Goal (incl. success criteria):
Land the final hosted app-session hardening addendum for billing success. Billing success should use normal Murph app-session auth, preserve the old suspended-member denial before Stripe success reconciliation, and keep the browser-vault origin guard from the already-present hardening patch.

Constraints/Assumptions:
Main hardening patch behavior is already present in the checkout for billing checkout/success and browser-vault session origin validation.
Do not disturb unrelated generated `apps/web/next-env.d.ts` local state.
This is high-risk hosted auth/billing work; run security/privacy, coverage-write, and task-finish audits plus required verification.

Key decisions:
Use `assertHostedMemberNotSuspended(auth.member)` in the billing success route immediately after app-session auth and before request body parsing or reconciliation.
Add focused route-test proof that suspended members are denied and reconciliation is not called.

State:
implemented; ready for scoped close/commit with unrelated verification blockers recorded

Done:
Reviewed the supplied patches; the original patch is stale because its behavior already exists in the current checkout.
Added `assertHostedMemberNotSuspended(auth.member)` to billing success immediately after app-session auth and before JSON body parsing or Stripe success reconciliation.
Added focused route-test proof for success ordering and suspended-member denial before body parsing/reconciliation.
Focused Vitest passed for `apps/web/test/hosted-onboarding-billing-success-route.test.ts`.
Security/privacy review passed with no findings.
Coverage-write pass added the body-parse ordering proof; focused Vitest passed afterward.
Scoped `git diff --check` passed for the touched files.
Final completion review found no code issues.

Now:
Closing the scoped plan and committing only the billing-success addendum files.

Next:
Handoff should mention unrelated red checks: broader `apps/web verify` currently fails on landing-page expectations in `apps/web/test/page.test.ts` and `app/design/components-content.tsx` `HeartbeatButtonProps.onSuccess` type errors; root `pnpm typecheck` fails on the same design component type errors.

Open questions (UNCONFIRMED if needed):
None.

Working set (files/ids/commands):
apps/web/app/api/hosted-onboarding/billing/success/route.ts
apps/web/test/hosted-onboarding-billing-success-route.test.ts
agent-docs/exec-plans/active/2026-05-03-app-session-billing-success-suspension.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
