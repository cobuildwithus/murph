# Recover incomplete hosted members at dashboard entry

Goal (incl. success criteria):
- Prevent authenticated hosted members whose onboarding is still at checkout from entering `/home` or another dashboard route and getting stuck behind active-access errors.
- Recover through the existing hosted onboarding state machine by issuing or reusing the member's web invite and redirecting to `/join/<inviteCode>`.
- Success means `not_started` and `incomplete` members redirect from dashboard routes after the dashboard hydrates, while active, anonymous, suspended, and other blocked billing states keep their existing behavior.

Constraints/Assumptions:
- Keep the correction at the shared dashboard shell boundary so `/home`, `/connect`, and sibling dashboard pages cannot drift.
- Do not add another dashboard auth/session database read to the server render path.
- Do not auto-activate, weaken active-access checks, add persisted recovery flags, or redirect suspended/blocked members into checkout.
- Reuse the idempotent hosted invite service and the canonical post-verification stage derivation.
- Preserve unrelated active ledger rows and avoid files owned by the hosted signup timezone handoff lane.

Key decisions:
- Treat the valid app session plus checkout-stage member as a recoverable onboarding state, not as sufficient dashboard entitlement.
- Keep the server layout on the existing sidebar auth snapshot only; use a no-UI client island to call a narrow recovery route after hydration.

State:
- In progress.

Done:
- Traced the stuck `/connect` error to dashboard entry accepting a valid app session before hosted activation is complete.
- Confirmed Privy completion issues the app session and a reusable invite before returning the checkout-stage join URL.

Now:
- Add the shared dashboard client recovery path and focused regression coverage.

Next:
- Run scoped verification, complete the required security/coverage/deep review, and open a PR.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/layout.tsx
- apps/web/app/api/hosted-onboarding/session/dashboard-recovery/route.ts
- apps/web/src/components/dashboard/dashboard-onboarding-recovery.tsx
- apps/web/src/components/dashboard/dashboard-shell.tsx
- apps/web/test/biomarker-layout.test.ts
- apps/web/test/dashboard-onboarding-recovery.test.tsx
- apps/web/test/hosted-onboarding-dashboard-recovery-route.test.ts
- pnpm test:diff <touched paths>
