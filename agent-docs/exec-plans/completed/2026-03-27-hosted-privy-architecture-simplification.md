# Hosted Privy architecture simplification in `apps/web`

## Goal

Simplify the hosted Privy onboarding architecture without changing product behavior: the client should rely on Privy SDK user state instead of parsing JWTs in the browser, the server should own cookie verification behind one helper, and public landing config should be separated from server-only Privy readiness checks.

## Scope

- Remove browser-side hosted JWT parsing/polling from the SMS auth flow.
- Centralize server-side `privy-id-token` cookie reading and local verification in one helper.
- Keep the hosted service/session model, but pass verified Privy identity data into business logic instead of raw token transport where possible.
- Move server-only Privy readiness logic out of the public landing helper surface.
- Update direct hosted Privy tests and docs to match the new boundaries.

## Constraints

- Do not widen into unrelated hosted webhook, RevNet, or billing behavior.
- Keep the hosted trust boundary strict: server must still require verified phone + embedded Ethereum wallet.
- Preserve the hosted app session model after Privy verification.
- Preserve current invite/public onboarding semantics and current route surface.

## Risks and mitigations

1. Risk: the Privy SDK `user.linkedAccounts` shape can differ from raw identity-token claims.
   Mitigation: normalize both shapes through shared linked-account helpers and add direct tests for SDK-style linked accounts.
2. Risk: removing the browser polling loop could race with wallet creation or identity-token cookie propagation.
   Mitigation: rely on Privy's documented login completion semantics, refresh the Privy user after SMS login, and keep the server-side cookie verification authoritative.
3. Risk: moving verification earlier in the route could blur business logic boundaries.
   Mitigation: keep service reconciliation logic pure around a typed hosted Privy identity object and leave all token/cookie concerns in the Privy helper.

## Verification

- Focused hosted tests for `privy.ts`, `privy-shared.ts`, route handling, provider config, and hosted Privy service behavior.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Required completion workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`
Status: completed
Updated: 2026-03-27
Completed: 2026-03-27
