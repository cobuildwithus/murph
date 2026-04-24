# Fix hosted onboarding activation recovery

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Stop paid hosted onboarding from waiting indefinitely when activation hits an invalid hosted bundle archive, and prevent Checkout from bypassing hosted Privy verification persistence.

## Success criteria

- Hosted billing Checkout reconciles the verified Privy invite identity before creating a Stripe Checkout Session.
- Checkout return reconciliation can persist hosted Privy verification even when Stripe webhooks already moved the invite out of the checkout stage.
- Cloudflare runner processing treats runtime-side invalid authoritative bundle restores as invalid input snapshots and quarantines them instead of retrying/backpressuring forever.
- Focused regression tests cover the Checkout/return reconciliation and Cloudflare runtime invalid-bundle path.

## Scope

- In scope:
- `apps/web/app/api/hosted-onboarding/billing/{checkout,success}/route.ts`
- `apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx`
- directly coupled `apps/web/test/**` hosted onboarding billing/success tests
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- directly coupled `apps/cloudflare/test/runner-run-processor.test.ts`
- this active plan and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
- Stripe product/pricing changes
- database schema changes
- broad hosted auth redesign
- hosted bundle archive format changes

## Constraints

- Preserve unrelated dirty-tree edits and active hosted-auth, hosted-billing, hosted-observability, and Cloudflare runner lanes.
- Do not log or persist raw personal identifiers, secrets, Stripe session ids, Privy tokens, or full local paths.
- Keep billing reconciliation idempotent; do not weaken subscription ownership checks.
- Quarantine only invalid authoritative input snapshots, not malformed runner output bundles.

## Risks and mitigations

1. Risk: Checkout-side verification could reject legitimate paid users if the auth session and invite are momentarily stale.
   Mitigation: reuse the existing hosted Privy completion service, which already owns invite/member reconciliation and staged error behavior.
2. Risk: invalid bundle classification could quarantine the wrong failure.
   Mitigation: restrict plain runtime invalid-archive quarantine to runs with a current authoritative bundle ref, while preserving explicit runner-output validation failures as generic failures.
3. Risk: success-page reconciliation could double-run success handling.
   Mitigation: keep the existing one-shot client guard and rely on idempotent server reconciliation.

## Tasks

1. Completed: register the task in the ledger and create this active plan.
2. Completed: inspect the checkout, success, success-page, runner processing, and directly coupled tests.
3. Completed: implement the narrow web and Cloudflare recovery fixes.
4. Completed: add focused regression coverage for both paths.
5. Completed: run focused tests, app/package typecheck, truthful scoped verification, `git diff --check`, and required audit passes.

## Decisions

- Treat the missing Privy persistence as a server-side reconciliation gap: Checkout and Checkout-success should both call the hosted Privy completion service before billing work proceeds.
- Treat runtime child failures with the hosted bundle invalid-archive message as invalid authoritative snapshots only when a current bundle ref exists.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-onboarding-billing-checkout-route.test.ts apps/web/test/hosted-onboarding-billing-success-route.test.ts apps/web/test/join-invite-success-client.test.ts apps/web/test/hosted-onboarding-routes.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare test -- --runInBand test/runner-run-processor.test.ts` passed and included package typecheck.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web lint` exited 0 with only pre-existing warnings outside the changed success-client file.
- `bash scripts/workspace-verify.sh test:diff <task paths>` passed before the final test-only coverage additions; the final additions were covered by focused web and Cloudflare reruns.
- `git diff --check` passed.
- Required `frontend-review` audit completed with no findings.
- Required `coverage-write` audit added active-stage success reconciliation coverage and runner-output non-quarantine coverage.
- Required `task-finish-review` audit completed with no findings.

## Outcome

- Hosted Checkout now runs hosted Privy completion before Stripe Checkout creation.
- Checkout success reconciliation now runs hosted Privy completion before billing success reconciliation.
- The success page now performs one-shot billing success reconciliation for checkout, activating, and active stages when the returned Stripe session id is present and the authenticated session matches the invite.
- Cloudflare run processing now quarantines invalid authoritative bundle archives discovered by the runtime child instead of retrying indefinitely, while explicit runner-output validation failures remain on the normal failure path.
Completed: 2026-04-24
