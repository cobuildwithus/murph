# Hosted Privy hard cutover in `apps/web`

## Goal

Replace the first hosted onboarding slice's passkey-based auth with Privy phone auth, embedded wallet provisioning, and server-side identity-token verification while preserving the thin hosted-control-plane boundary.

## Scope

- Update hosted onboarding env/docs/routes/components/tests from passkeys to Privy phone auth.
- Add Privy client/server helpers plus the browser completion route that verifies identity tokens and attaches the hosted session cookie.
- Apply the Prisma hard cutover that removes passkey-backed schema/state and replaces it with Privy-linked hosted member fields.
- Keep hosted share, Linq webhook, and billing flows aligned with the new verified-phone session model.

## Constraints

- Keep canonical health and inbox data out of the hosted app.
- Do not expose secrets, raw identity tokens, or wallet-sensitive material in logs, docs, tests, or fixtures.
- Preserve adjacent hosted landing-page and device-sync work already present in the tree.
- Prefer existing hosted-onboarding patterns where they still fit instead of adding new abstraction layers without need.

## Risks and mitigations

1. Risk: auth-token misuse between Privy access tokens and identity tokens could silently create invalid sessions.
   Mitigation: keep verification logic explicit, require identity tokens on the new completion route, and add focused service/route tests.
2. Risk: the hard-cut Prisma migration can orphan old passkey state or drift from the schema.
   Mitigation: land both migration files with schema updates and keep runtime code/tests aligned to the new fields only.
3. Risk: hosted onboarding copy and join/share flows can keep stale passkey assumptions.
   Mitigation: review route/UI/test copy after the patch and update remaining passkey references or stale control flow.

## Verification

- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Direct scenario proof: inspect the hosted web onboarding UI at desktop and mobile widths and record the result.
- Required completion workflow audit passes: `simplify`, `task-finish-review` (the final review also checks coverage/proof gaps)
