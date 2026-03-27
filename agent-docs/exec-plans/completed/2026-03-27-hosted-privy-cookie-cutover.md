# Hosted Privy cookie cutover in `apps/web`

## Goal

Move hosted onboarding off client-posted Privy identity tokens and manual wallet creation so the browser relies on Privy's cookie-backed identity session plus automatic embedded wallet creation on login.

## Scope

- Update the hosted Privy provider/client flow to enable automatic embedded wallet creation and remove the manual `useCreateWallet` retry loop.
- Change the hosted Privy completion route to read the Privy identity token from request cookies, not from JSON request bodies.
- Add focused hosted onboarding tests and doc updates for the cookie-first flow.

## Constraints

- Keep hosted onboarding thin: Privy still owns SMS verification and embedded wallet provisioning.
- Keep hosted session issuance first-party in `apps/web`; do not replace it with raw Privy session state.
- Preserve adjacent dirty env/runtime work already in progress under `apps/web/src/lib/hosted-onboarding/{env,runtime}.ts`.
- Avoid adding new auth abstractions unless they remove real complexity immediately.

## Risks and mitigations

1. Risk: already-authenticated Privy sessions without an embedded wallet can become a dead-end if the manual wallet creation path disappears.
   Mitigation: gate the "continue" path on both a verified phone and an embedded wallet, and direct those users to sign out and re-run SMS login.
2. Risk: moving token transport to cookies can silently break if the completion route still expects a body token.
   Mitigation: add focused route coverage for the cookie path and missing-cookie failure case.
3. Risk: the auto wallet create-on-login behavior can regress if the provider config drifts.
   Mitigation: align the provider config with the working `../interface` pattern and keep the hosted flow tests updated.

## Verification

- Focused app checks: `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web test`
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Direct scenario proof: run a narrow hosted onboarding request path that proves the completion route reads the cookie and still issues the hosted session cookie.
- Required completion workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`
Status: completed
Updated: 2026-03-27
Completed: 2026-03-27
