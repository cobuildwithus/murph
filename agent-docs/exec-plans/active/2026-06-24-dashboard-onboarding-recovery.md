# Recover incomplete hosted members at dashboard entry

Goal (incl. success criteria):
- Prevent authenticated hosted members whose onboarding is still at checkout from entering `/home` or another dashboard route and getting stuck behind active-access errors.
- Recover through the existing hosted onboarding state machine by issuing or reusing the member's web invite and redirecting to `/join/<inviteCode>`.
- Success means `not_started` and `incomplete` members redirect before dashboard content loads, while active, anonymous, suspended, and other blocked billing states keep their existing behavior.

Constraints/Assumptions:
- Keep the correction at the shared dashboard route boundary so `/home`, `/connect`, and sibling dashboard pages cannot drift.
- Do not auto-activate, weaken active-access checks, add persisted recovery flags, or redirect suspended/blocked members into checkout.
- Reuse the idempotent hosted invite service and the canonical post-verification stage derivation.
- Preserve unrelated active ledger rows and avoid files owned by the hosted signup timezone handoff lane.

Key decisions:
- Treat the valid app session plus checkout-stage member as a recoverable onboarding state, not as sufficient dashboard entitlement.
- Redirect server-side before rendering the dashboard shell or child page.

State:
- In progress.

Done:
- Traced the stuck `/connect` error to dashboard entry accepting a valid app session before hosted activation is complete.
- Confirmed Privy completion issues the app session and a reusable invite before returning the checkout-stage join URL.

Now:
- Add the shared dashboard guard and focused regression coverage.

Next:
- Run scoped verification, complete the required security/coverage/deep review, and open a PR.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/layout.tsx
- apps/web/test/biomarker-layout.test.ts
- pnpm test:diff <touched paths>
