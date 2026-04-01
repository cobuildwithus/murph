# 2026-04-01 Hosted Privy Completion Fail-Closed

## Goal

Stop the hosted homepage phone-auth client from endlessly re-posting `/api/hosted-onboarding/privy/complete` when the Privy HttpOnly identity cookie is unavailable, while preserving the existing happy-path auto-continue behavior.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- focused client tests under `apps/web/test/**`
- no backend contract changes unless the existing client boundary makes the fail-closed fix impossible

## Constraints

- Treat this as an auth/trust-boundary fix: do not weaken server-side cookie requirements.
- Preserve the current successful flow where an authenticated Privy session auto-continues after phone and wallet readiness.
- Fail closed on terminal completion auth errors instead of retrying indefinitely.
- Keep the change narrow and compatible with the existing hosted onboarding flow.

## Risks

1. The client could suppress a genuinely recoverable completion lag.
   Mitigation: only suppress terminal auth failures; keep the existing retry path for explicit retryable server-not-ready errors.
2. The fix could accidentally break successful auto-continue behavior for returning authenticated users.
   Mitigation: add focused tests for both the terminal failure and the happy path trigger conditions.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- direct local scenario reasoning from the reproduced localhost-plus-HttpOnly-cookie mismatch

## Notes

- Localhost cannot receive the `privy-id-token` cookie when Privy HttpOnly cookies are configured for `withmurph.ai`; the client must surface that cleanly instead of hammering the completion route.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
