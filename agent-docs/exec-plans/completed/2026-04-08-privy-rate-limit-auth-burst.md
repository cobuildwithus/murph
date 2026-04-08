# Reduce hosted Privy auth burst traffic during signup

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Reduce first-time hosted Privy signup/session bursts so normal onboarding does not trip Privy 429s during `/users/me` hydration or token refresh.

## Success criteria

- Hosted same-origin auth requests prefer cookie-backed Privy session state before forcing client-side token refresh.
- Hosted signup/auth fetches avoid redundant back-to-back `getAccessToken()`/`getIdentityToken()` calls during a short burst window.
- Focused hosted-web tests cover the new cookie fallback and burst-collapsing behavior.
- Required hosted-web verification passes for the touched scope.

## Scope

- In scope:
- `apps/web` hosted onboarding/browser auth request path.
- Hosted Privy request parsing in server helpers.
- Focused tests for the changed auth behavior.
- Out of scope:
- Dashboard-side Privy configuration changes.
- Larger onboarding UX or invite-flow refactors.
- Non-hosted packages or Cloudflare auth surfaces.

## Constraints

- Technical constraints:
- Preserve existing same-origin browser auth semantics for routes that require both Privy access and identity validation.
- Do not assume HttpOnly cookie config is present in every environment; keep a fallback path for environments that still need explicit headers.
- Product/process constraints:
- Keep the diff narrow because other hosted-auth work is active in adjacent files.
- Preserve unrelated worktree edits and existing hosted-auth fixes.

## Risks and mitigations

1. Risk: Cookie-first auth could break environments without Privy cookie support.
   Mitigation: Fall back to explicit client token retrieval when cookie-backed requests come back unauthenticated.
2. Risk: Short-lived client auth caching could reuse expired tokens.
   Mitigation: Keep the cache burst-only and invalidate on auth failures.

## Tasks

1. Register coordination scope and inspect current hosted Privy request flow.
2. Patch server request-auth helpers to accept Privy access token cookies in addition to bearer headers.
3. Patch the client request helper to try cookie-first same-origin auth and collapse duplicate token-refresh work during bursts.
4. Add focused tests for cookie fallback and auth-header reuse.
5. Run required hosted-web verification, audit, and commit flow.

## Decisions

- Cookie-backed same-origin auth is the preferred path because Privy docs already recommend HttpOnly cookies for production and automatically include identity-token cookies when configured.
- Keep explicit header auth as a compatibility fallback instead of hard-cutting to cookies only.
- Simplify review found no meaningful behavior-preserving cutback opportunity in the auth path.
- Final completion review found no code issues; remaining risk is environment-level verification that deployed Privy clients really set both cookies.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- --run hosted-onboarding-client-api.test.ts hosted-onboarding-request-auth.test.ts`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web verify`
- Expected outcomes:
- Focused tests cover the new auth path and pass.
- Hosted-web lint and verify pass on the touched scope.
- Outcomes:
- `pnpm --dir apps/web test -- --run test/hosted-onboarding-client-api.test.ts test/hosted-onboarding-request-auth.test.ts` passed twice; the app test lane executed green in this workspace.
- `pnpm --dir apps/web lint` passed with pre-existing warnings only.
- `pnpm --dir apps/web verify` passed twice after the final helper cleanup.
Completed: 2026-04-08
