Goal (incl. success criteria):
- Fix Family-plan hosted replies being gated off when Stripe subscription period timestamps are present on subscription items but absent on the top-level subscription payload.
- Keep the correction at the Family billing ingestion boundary, with no new retry system, fallback queue, or duplicate billing source of truth.
- Success means the Family group billing ref stores a valid period from item-level Stripe data, direct billing can remain cleared, and the hosted AI usage gate allows the sponsored member.

Constraints/Assumptions:
- Web owns Stripe billing event ingestion and hosted usage gating.
- Family group billing ref remains the single access source for Family sponsorship after direct paid billing is cleared.
- Keep changes narrow to period extraction and focused tests.
- Preserve unrelated ledger rows and current-checkout dirty work.

Key decisions:
- Reuse the existing Stripe subscription payload rather than repairing members individually in code.
- Read item-level subscription periods only when the top-level period is absent or invalid.

State:
- Verification complete; ready for plan close and PR.

Done:
- Traced the failure path from accepted inbound messages to hosted access gating.
- Confirmed Family group billing refs with null periods are treated as inactive for sponsored access.
- Implemented the item-level Stripe period fallback on the validated Family seat item.
- Added regressions for Family subscription webhooks and direct paid-to-Family upgrades with item-level periods.
- Verified focused Family tests, app typecheck, `test:diff`, app verification, and full acceptance with unrelated package coverage flakes isolated by passing targeted reruns.

Now:
- Close the plan and commit the scoped diff.

Next:
- Open a draft PR and run the ReviewGPT PR loop to completion.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/family-plan.ts
- apps/web/test/hosted-family-plan.test.ts
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
