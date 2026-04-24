# Add hosted checkout success timeout support

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Give hosted Checkout success users a clear support path when setup stays pending for about 60 seconds instead of leaving them with only an indefinite spinner.

## Success criteria

- The success page keeps polling while setup is pending.
- After 60 seconds of a pending success state, the page shows a concise delayed-setup message and an email-support action.
- The support email target uses the existing support address and includes bounded setup context without exposing Stripe session ids or secrets.
- Focused component tests cover the delayed support state.

## Scope

- In scope:
- `apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx`
- `apps/web/test/join-invite-success-client.test.ts`
- this active plan and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
- New support ticket infrastructure
- Stripe, Privy, or Cloudflare runtime changes
- Checkout pricing/billing behavior

## Constraints

- Preserve unrelated dirty-tree edits and active hosted auth/billing/runtime lanes.
- Do not include raw Stripe session ids, Privy tokens, secrets, raw contact identifiers, or local paths in support copy, test fixtures, or logs.
- Avoid visual redesign; this is a recovery affordance for the existing success page.

## Tasks

1. Completed: register the task in the ledger and create this active plan.
2. Completed: inspect existing support/contact patterns and success-page tests.
3. Completed: implement the delayed support affordance.
4. Completed: add focused regression coverage.
5. Completed: run focused verification and required audits.

## Decisions

- Use `support@withmurph.ai`, matching the existing global footer and blocked-account join flow.
- Do not put the Stripe Checkout session id in the mailto body; invite code and current stage are enough for support to investigate.
- Do not claim a durable setup-delay log was created. A runtime-log-only endpoint was considered and removed; the final UI says the support email draft includes setup context.

## Verification

- Passed: `pnpm exec vitest run apps/web/test/join-invite-success-client.test.ts --config apps/web/vitest.config.ts --no-coverage`.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `pnpm --dir apps/web lint`; warnings were pre-existing outside the touched component.
- Passed: `bash scripts/workspace-verify.sh test:diff apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx apps/web/test/join-invite-success-client.test.ts`; this included app dev smoke, build, tests, and lint.
- Passed: `git diff --check`.
- Passed: required `frontend-review`; no blocking UX, accessibility, responsive, or privacy findings.
- Completed: required `task-finish-review`; process-only findings were addressed.

## Outcome

- Checkout success users who remain pending for about 60 seconds now see a clean support affordance while automatic polling continues.
- The email support action opens a draft to the existing support address with invite code and current stage only; the Stripe Checkout session id is not included.
Completed: 2026-04-24
