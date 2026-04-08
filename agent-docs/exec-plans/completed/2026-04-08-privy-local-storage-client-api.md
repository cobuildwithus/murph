# Align hosted Privy client auth with local-storage session docs

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Simplify hosted Privy client auth so it matches Privy's local-storage session guidance: send bearer + identity headers directly, avoid cookie-first probing, and minimize unnecessary Privy refresh traffic.

## Success criteria

- `requestHostedOnboardingJson` no longer does an unauthenticated first fetch as a cookie probe.
- Hosted client auth still dedupes bursty token refresh work and still supports one auth-refresh retry when the backend returns `401`.
- Server request parsing no longer depends on access-token cookie fallback introduced for the cookie-first path.
- Focused hosted-web tests and full hosted-web verification pass.

## Scope

- In scope:
- `apps/web` hosted Privy client auth transport and matching tests.
- Removal of the temporary cookie-first request path added for the previous fix.
- Out of scope:
- Wider hosted onboarding flow changes.
- Privy dashboard configuration changes.
- Cloudflare or non-web auth surfaces.

## Constraints

- Technical constraints:
- This app uses Privy local-storage sessions, not HttpOnly access-token cookies.
- Keep explicit bearer + identity-token auth semantics for hosted routes.
- Product/process constraints:
- Preserve unrelated hosted-auth worktree edits.

## Risks and mitigations

1. Risk: Removing the cookie-first path could reintroduce bursty token refresh calls.
   Mitigation: Keep the short-lived in-memory cache and in-flight dedupe for explicit header retrieval.
2. Risk: Retrying on `401` could still stampede if several requests invalidate the cache simultaneously.
   Mitigation: Reuse the shared in-flight promise and keep retry count bounded to one.

## Tasks

1. Confirm the official Privy local-storage docs for access-token and identity-token transport.
2. Refactor hosted client auth to always send explicit auth headers, with bounded refresh retry only after `401`.
3. Remove temporary server request cookie fallback added for the cookie-first experiment.
4. Update focused tests and rerun required hosted-web verification.

## Decisions

- Follow Privy's local-storage guidance: access token in `Authorization`, identity token supplied client-side rather than relying on access-token cookies.
- Keep burst-collapsing header cache/singleflight because it addresses the user's observed 429 burst without requiring cookies.
- Preserve the anonymous optional-auth fast path by only attaching cached headers on the first request for `auth: "optional"` and only rebuilding explicit headers after a `401` when a session is already present.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- --run test/hosted-onboarding-client-api.test.ts test/hosted-onboarding-request-auth.test.ts`
- `pnpm --dir apps/web verify`
- Expected outcomes:
- Focused auth tests pass.
- Full hosted-web verify lane passes after the simplification.
- Actual outcomes:
- `pnpm --dir apps/web test -- --run test/hosted-onboarding-client-api.test.ts test/hosted-onboarding-request-auth.test.ts` passed after the local-storage refactor and again after the optional-auth fast-path fix.
- `pnpm --dir apps/web verify` passed after the refactor and again after the optional-auth fast-path fix. The run still emitted pre-existing lint and Turbopack warnings, but exited successfully.

## Review follow-up

- Final review found one medium issue: `auth: "optional"` requests were eagerly resolving Privy headers on the first fetch, which added avoidable latency for anonymous browsers.
- Resolved by introducing `resolveInitialHostedOnboardingAuthHeaders()` so optional requests start with cached headers only and preserve the no-session fast path.
Completed: 2026-04-08
