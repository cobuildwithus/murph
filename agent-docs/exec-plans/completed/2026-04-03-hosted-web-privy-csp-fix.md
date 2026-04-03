# Allow hosted web CSP to trust the configured Privy custom domain

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Let hosted web onboarding/settings/share pages load Privy successfully when the SDK uses a custom auth domain, without weakening the existing CSP defaults.

## Success criteria

- `apps/web` CSP includes the active Privy custom origin in `child-src`, `frame-src`, and `connect-src`.
- Existing default Privy and WalletConnect protections remain in place.
- Focused `apps/web` config tests cover explicit custom-domain envs plus hosted-public-url fallback behavior.
- Required `apps/web` verification passes, or any unrelated pre-existing failure is documented precisely.

## Scope

- In scope:
- `apps/web/next.config.ts` CSP source resolution for Privy custom domains.
- Focused `apps/web` tests covering the CSP/env behavior.
- `apps/web/README.md` env guidance for the Privy custom-domain configuration.
- Out of scope:
- Changing hosted onboarding runtime/auth flows outside the CSP/env surface.
- Changing Privy dashboard configuration or any deployed secret values.

## Constraints

- Technical constraints:
- Preserve the existing restrictive CSP and only add the minimum custom-domain allowlist needed for Privy.
- Do not print or persist live env values while debugging.
- Product/process constraints:
- Preserve unrelated dirty-tree edits in the repo, especially active hosted/runtime work.
- Use the repo coordination ledger and finish with scoped verification plus a scoped commit.

## Risks and mitigations

1. Risk: Over-broad CSP relaxation could weaken the hosted auth boundary.
   Mitigation: Only allow the resolved Privy custom origin and keep all existing defaults/tests.
2. Risk: Relying on one undocumented env key could leave some environments broken.
   Mitigation: Support explicit custom-domain envs, the existing base-domain env, and a hosted-public-origin fallback.

## Tasks

1. Register the active lane in the coordination ledger and keep the plan current.
2. Patch hosted-web CSP origin resolution for Privy custom domains.
3. Add or update focused `apps/web` tests and README guidance.
4. Run required verification plus one direct scenario check, then finish with a scoped commit.

## Decisions

- Prefer deriving the Privy custom origin from explicit envs first, then from the hosted public origin as a fallback, instead of hardcoding a deployment-specific hostname.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- --run test/next-config.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- direct scenario check: inspect `buildHostedWebContentSecurityPolicy(...)` output for the custom-domain case
- Expected outcomes:
- Focused tests prove the resolved custom origin reaches the CSP directives that currently fail in the browser.
- Required repo/app checks succeed, or any unrelated red lane is explicitly called out with cause.
Completed: 2026-04-03
