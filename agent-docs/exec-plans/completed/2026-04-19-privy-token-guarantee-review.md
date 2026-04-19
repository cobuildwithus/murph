## Goal

Harden the hosted Privy verifier config helpers, add direct proof that read-side verification does not depend on `PRIVY_APP_SECRET`, and verify from official Privy docs whether `murph_member_id` can be treated as guaranteed in the identity token for removing the DB fallback.

## Scope

- `apps/web/src/lib/hosted-onboarding/privy.ts`
- `apps/web/test/hosted-onboarding-privy.test.ts`
- Nearby hosted session/request-auth call paths for review only
- Official Privy docs only for token-guarantee assessment

## Constraints

- Keep `PrivyClient.users().setCustomMetadata(...)` for metadata writes.
- Do not print or depend on real env values.
- Do not remove the DB fallback unless the token guarantee is documented strongly enough for a hard invariant.

## Verification

- Focused hosted Privy tests in `apps/web`
- Required audit passes per repo workflow if code changes land
- Official Privy docs evidence for any token-guarantee claim

## Outcome

- Hardened hosted Privy verifier config normalization so whitespace-only or escaped-newline-only verification keys fail as config errors.
- Added direct proof that read-side identity-token verification does not depend on `PRIVY_APP_SECRET`.
- Confirmed from official Privy docs that identity tokens include `custom_metadata`, but did **not** find a hard guarantee that a just-written metadata field will be present on every immediately subsequent request.

## Evidence

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts hosted-onboarding-privy.test.ts` -> passed
- `pnpm --dir apps/web typecheck` -> still fails for pre-existing missing modules `@privy-io/react-auth`, `@privy-io/node`, `@cobuild/wire`; plus unrelated active-lane parser errors in `packages/hosted-execution/src/parsers.ts`
- Required `coverage-write` audit pass -> no further test changes needed
- Required `task-finish-review` audit pass -> no findings

## Docs conclusion

- Privy docs say identity tokens contain `custom_metadata` and can be used to avoid extra API calls for user data.
- Privy docs also describe identity-token refresh as event-driven and recommend client refresh behavior after backend updates, which is not strong enough to treat `murph_member_id` as a universal invariant on every server request.
- Removing the DB fallback would therefore require a product decision to fail closed when the token is stale/missing metadata, not just a docs-backed confidence bump.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
