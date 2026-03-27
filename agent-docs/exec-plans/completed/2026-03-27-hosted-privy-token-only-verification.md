# Hosted Privy token-only verification in `apps/web`

## Goal

Remove the hosted onboarding lane's dependency on `PrivyClient` and verify the `privy-id-token` cookie locally on the server using Privy's verification key plus the token claims alone.

## Scope

- Add hosted onboarding support for `PRIVY_VERIFICATION_KEY`.
- Replace `PrivyClient.users().get({ id_token })` in hosted onboarding with local identity-token verification.
- Keep the hosted flow cookie-first and keep wallet provisioning on Privy's client SDK path.
- Add focused tests that prove the hosted verifier works from token claims only.

## Constraints

- Do not broaden into the already-dirty hosted RevNet lane or unrelated env-prefix work.
- Preserve the current hosted session issuance model after Privy verification succeeds.
- Keep the hosted requirements strict: verified phone plus embedded Ethereum wallet.
- Remove `PrivyClient` usage from this hosted lane entirely.

## Risks and mitigations

1. Risk: identity-token claims may be more compact than the full user API payload and lose fields the hosted parser expects.
   Mitigation: inspect Privy's local verifier output and adjust hosted parsing to accept the verified token-only shapes explicitly, with tests.
2. Risk: introducing `PRIVY_VERIFICATION_KEY` can break environments that still only provide `PRIVY_APP_SECRET`.
   Mitigation: fail with a precise config error and update the hosted app docs for the new requirement.
3. Risk: token-only parsing could accidentally loosen wallet or phone validation.
   Mitigation: keep the existing hosted phone/wallet invariants and add regression tests around malformed, missing, and wrong-chain linked accounts.

## Verification

- Focused hosted tests around `privy.ts`, hosted onboarding service behavior, and env parsing.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Direct scenario proof: verify a real cookie string and locally verified identity token claims produce the hosted identity object without calling Privy APIs.
- Required completion workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`
Status: completed
Updated: 2026-03-27
Completed: 2026-03-27
