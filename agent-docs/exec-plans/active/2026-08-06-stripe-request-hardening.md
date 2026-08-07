Goal (incl. success criteria):
- Prevent Stripe request parameter drift from bypassing TypeScript and reaching production.
- Success means Stripe request payloads are spread-free, the paid Pulse billing mocks derive call signatures from the official Stripe SDK, a safe opt-in test-mode resume contract probe exists, and repository verification rejects future Stripe request spreads.

Constraints/Assumptions:
- Preserve existing billing behavior and idempotency semantics; this is boundary hardening, not a billing-flow redesign.
- Use the installed official Stripe SDK and existing repository parser/tooling; add no dependency or new runtime service.
- The live contract probe must reject live-mode credentials and must not create, charge, or mutate a real Stripe resource.
- Preserve unrelated work in the primary checkout and keep private incident evidence out of durable artifacts.

Key decisions:
- Ban every object spread reachable from an argument to an official Stripe SDK call, because conditional spreads and pre-built objects both bypass excess-property checks.
- Remediate optional Stripe fields through SDK-typed local parameter objects plus explicit assignments so invalid keys fail TypeScript.
- Probe the real test-mode `subscriptions.resume` endpoint with a deliberately nonexistent subscription ID and require Stripe's safe `resource_missing` response; `parameter_unknown` or any other response fails the contract.

State:
- Candidate implementation verified locally; preparing the exact pushed PR head for review and CI.

Done:
- Read required repository architecture, product, security, reliability, verification, and completion guidance.
- Confirmed the official Stripe SDK types reject the invalid resume field when written directly but TypeScript accepts it through an object spread.
- Created an isolated task worktree from current `origin/main`.
- Replaced every detected Stripe request object spread with an SDK-typed object and explicit optional-field assignments across Checkout, subscriptions, refunds, recovery pagination, and request options.
- Added the Babel-based Stripe request spread guard, alias and typed-builder coverage, and root typecheck/diff-preflight wiring.
- Derived the paid-Pulse Stripe mock argument tuples and expected resume params from the official SDK declarations.
- Added the opt-in test-mode resume contract probe, live-key refusal, and fixture-only unit coverage.
- Passed the guard, repo-tool tests, hosted-web TypeScript and lint, 611 focused hosted-web billing tests, shell syntax, and diff hygiene.

Now:
- Commit, reconcile with current main, push, and open the PR.

Next:
- Run required preliminary specialist and final ReviewGPT gates concurrently with CI on the exact pushed head.
- Resolve any findings, complete final review, and archive the plan in the final scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/hosted-onboarding-billing-start-paid-pulse-service.test.ts`
- `apps/web/scripts/verify-stripe-subscription-resume-contract.ts`
- `scripts/check-stripe-request-spreads.ts`
- `scripts/workspace-verify.sh`
- `agent-docs/SECURITY.md`
- `agent-docs/references/testing-ci-map.md`
