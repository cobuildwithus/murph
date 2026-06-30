# Family paid plan upgrade hotfix

Status: completed
Created: 2026-06-30
Updated: 2026-06-30

## Goal

- Let an existing direct paid Pulse/Edge member upgrade to Family from Settings or hosted chat tools without needing a second account, manual Stripe work, or a separate checkout when they already have an active Stripe subscription.

## Success criteria

- Paid direct members see an enabled Family start action when they are not already active Family owners, sponsored members, or suspended.
- Starting Family from an active direct paid subscription converts the existing Stripe subscription to the Family seat price, preserves the customer/subscription, and activates the Family group when Stripe confirms the paid state.
- The hosted chat tool can create the owner Family group and complete the same direct-paid conversion path instead of returning a blocked checkout error.
- Existing invite acceptance rules still reject direct paid members who try to join someone else's Family group.
- Focused Family billing and Settings page tests pass, plus the required web diff verification passes.

## Scope

- In scope:
  - Settings Family CTA eligibility.
  - Hosted Family billing start flow.
  - Stripe subscription item conversion for active direct paid owners.
  - Focused backend and Settings tests.
- Out of scope:
  - New billing tables, new Stripe products, or a Cloudflare runtime deploy.
  - CI performance tuning.

## Constraints

- Technical constraints:
  - Keep Stripe billing ownership in the existing hosted Family billing module.
  - Do not weaken direct-paid member rejection for invited Family members.
  - Avoid new persisted state; use Stripe and existing hosted billing refs as the source of truth.
- Product/process constraints:
  - This is a live hotfix for a paid user-facing upgrade path.
  - Keep behavior compatible with existing Family checkout and invite flows.

## Risks and mitigations

1. Risk: A paid owner keeps both direct and Family entitlements after conversion.
   Mitigation: Clear the direct member billing ref after the Family group is reconciled as paid.
2. Risk: Stripe update enters a pending/incomplete state.
   Mitigation: Return a Billing Portal URL instead of claiming activation until Stripe reflects a paid Family subscription.
3. Risk: Relaxing direct-paid checks lets direct paid users join someone else's Family group.
   Mitigation: Limit the bypass to owner billing-start paths and preserve the invite acceptance guard.

## Tasks

1. Inspect the current Settings and hosted Family checkout eligibility gates.
2. Implement direct-paid owner Family conversion on the existing Stripe subscription.
3. Add focused tests for UI eligibility and direct subscription conversion.
4. Run scoped verification and the required web diff verification.
5. Archive the plan, commit, push, and open the PR/deploy path.

## Decisions

- Convert the existing direct paid subscription in place instead of creating a second Checkout Session. This keeps Stripe customer history intact and avoids duplicate active subscriptions.
- Use existing Family billing refs and membership activation paths; no new state is added.

## Verification

- Commands run:
  - `pnpm exec vitest run apps/web/test/hosted-family-plan.test.ts --config apps/web/vitest.workspace.ts --project hosted-web-store-config`
  - `pnpm exec vitest run apps/web/test/settings-page.test.ts --config apps/web/vitest.config.ts`
  - `pnpm --dir apps/web typecheck`
  - `git diff --check`
  - `pnpm test:diff apps/web/src/lib/hosted-onboarding/family-plan.ts apps/web/src/components/settings/hosted-family-settings-actions.tsx 'apps/web/app/(dashboard)/settings/page.tsx' apps/web/test/hosted-family-plan.test.ts apps/web/test/settings-page.test.ts`
- Expected outcomes:
  - Focused tests pass.
  - Typecheck passes.
  - Diff whitespace check passes.
  - Web diff verification exits 0.
Completed: 2026-06-30
