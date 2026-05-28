## Goal

Keep local hosted onboarding invite/join links on the localhost browser origin during local development, even when local Linq webhook setup has configured a public tunnel origin for provider webhook delivery.

## Scope

- `scripts/dev-hosted-local/environment.ts`
- `scripts/dev-hosted-local/stack.ts`
- focused hosted-local dev script tests

## Constraints

- Preserve the Linq tunnel as the provider-facing webhook registration target.
- Do not change Stripe Checkout success/cancel URLs or provider callback origins.
- Do not make the tunnel the default browser app origin for local onboarding.
- Preserve production hosted public-origin behavior outside the local dev orchestrator.

## Verification

- Focused tests for hosted-local env override and stack wiring.
- Scoped verification per repo policy, unless blocked by unrelated dirty checkout failures.
