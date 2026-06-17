# Auto Pulse trial enrollment

Status: completed
Created: 2026-06-14
Updated: 2026-06-14

## Goal

- Land the externally prepared no-card Pulse trial enrollment patch on a fresh
  PR branch, while preserving the hosted billing, Stripe reconciliation,
  rollout-flag, and `/home` redirect invariants.

## Success criteria

- Patch applies cleanly to current `origin/main`.
- Auto-trial enrollment remains gated by the backend rollout flag and cannot be
  triggered by a crafted request while disabled.
- Hosted billing/Stripe subscription status changes continue to preserve trial
  and paid entitlement boundaries.
- Focused tests, typecheck, required audits, and PR checks are run or any
  unrelated blockers are documented.
- A scoped commit is pushed and a draft PR is opened.

## Scope

- In scope:
  - `apps/web` hosted onboarding billing/enrollment source and focused tests.
  - Required repo plan/ledger lifecycle for this PR-lane change.
- Out of scope:
  - Stripe product/price changes.
  - Cloudflare runtime enforcement changes.
  - New hosted plan codes or free-plan state.

## Constraints

- Technical constraints:
  - Reuse existing hosted billing primitives and keep state transitions
    idempotent.
  - Keep rollout flag checks server-side, not only in client UI.
  - Preserve narrow public API request shape and existing checkout behavior.
- Product/process constraints:
  - Treat the supplied patch as behavioral intent, not overwrite authority.
  - Preserve unrelated active ledger rows and working-tree edits.
  - Avoid exposing personal/local identifiers or secrets in commits, docs, logs,
    or PR text.

## Risks and mitigations

1. Risk: trial enrollment grants access without the rollout flag.
   Mitigation: inspect service/route guard and run focused tests.
2. Risk: Stripe subscription events accidentally promote trial users to paid or
   reactivate paused/inactive users.
   Mitigation: inspect reconciliation paths and run billing event tests.
3. Risk: patch drift from current `main` introduces stale imports or test gaps.
   Mitigation: apply on fresh `origin/main`, run typecheck and hosted-web tests.

## Tasks

1. Apply the supplied patch to the isolated worktree.
2. Inspect the resulting diff for privacy, scope, and architectural fit.
3. Fix any apply/type/test failures with the smallest scoped changes.
4. Run required verification and completion audits.
5. Commit with `scripts/finish-task`, push, open a draft PR, and run PR review
   loop as far as available.

## Decisions

- Use an isolated worktree from `origin/main` and branch
  `codex/auto-pulse-trial-enrollment` because the main checkout is already on
  another task branch.
- Keep the no-card enrollment behind `HOSTED_AUTO_PULSE_TRIAL_ENABLED` in both
  server routing and service code.
- Use a dedicated auto-trial freshness policy so a same-subscription passive
  Stripe webhook cannot make the local entitlement write fail after Stripe has
  already created the trial.
- Let `customer.subscription.resumed` restore active access only when the live
  canonical Stripe subscription is active; ordinary subscription updates remain
  conservative until invoice proof promotes access.

## Verification

- Completed:
  - Native Codex audit subagents: security/privacy, frontend, coverage-write,
    and final deep-review.
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-stripe-billing-status.test.ts apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts apps/web/test/hosted-onboarding-auto-trial-enrollment-service.test.ts apps/web/test/join-invite-islands.test.ts apps/web/test/join-invite-page-view.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-auto-trial-enrollment-route.test.ts`
    passed.
  - `pnpm --dir apps/web health-commons:generate && pnpm --dir apps/web prisma:generate && pnpm --dir apps/web test:prepared -- apps/web/test/hosted-onboarding-auto-trial-enrollment-route.test.ts apps/web/test/hosted-onboarding-auto-trial-enrollment-service.test.ts apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts apps/web/test/hosted-onboarding-stripe-billing-status.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/join-invite-islands.test.ts apps/web/test/join-invite-page-view.test.ts`
    passed.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm --dir apps/web verify` passed.
- Blocked:
  - `pnpm verify:acceptance` failed before the app lanes during
    `packages/assistant-cli` typecheck on missing assistant/operator package
    entrypoints in untouched package areas.
Completed: 2026-06-14
