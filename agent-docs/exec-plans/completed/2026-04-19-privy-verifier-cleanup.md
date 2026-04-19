## Goal

Revert the hosted Privy identity-token read path from `PrivyClient.users().get({ id_token })` back to the direct `verifyIdentityToken(...)` helper while keeping the Murph member-id metadata write path and session fast path intact.

## Scope

- `apps/web/src/lib/hosted-onboarding/privy.ts`
- `apps/web/test/hosted-onboarding-privy.test.ts`

## Constraints

- Keep `PrivyClient.users().setCustomMetadata(...)` for writing `murph_member_id`.
- Do not weaken the member-id fast path or the DB fallback for stale/missing token member ids.
- Do not print or depend on real env values.

## Verification

- Focused `apps/web` Privy verification test lane
- Required audit passes per repo workflow for this auth-boundary follow-up

## Outcome

- Reverted hosted Privy read-side verification to direct `verifyIdentityToken(...)`.
- Kept `PrivyClient.users().setCustomMetadata(...)` for Murph member-id writes.
- Narrowed hosted phone-auth readiness checks so the read-side verifier depends only on app id plus verification key.

## Evidence

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts hosted-onboarding-privy.test.ts` -> passed
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts hosted-onboarding-privy.test.ts -t "verifies the identity token directly and uses the verified linked accounts"` -> passed
- `pnpm --dir apps/web typecheck` -> still fails for pre-existing missing modules: `@privy-io/react-auth`, `@privy-io/node`, `@cobuild/wire`
- Required `coverage-write` audit pass -> no further test changes needed
- Required `task-finish-review` audit pass -> no findings
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
