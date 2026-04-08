Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

This prompt is for Batch 2 and should run only after Batch 1 foundation changes are reviewed and integrated.

You own the auth/onboarding cutover from the wide `HostedMember` identity fields to the new identity-side storage.

Constraints:

- Preserve unrelated dirty-tree edits.
- Assume Batch 1 already introduced the additive tables and helper layer; do not redesign that foundation.
- Keep email out of Postgres.
- Keep wallet logic conditional on Revnet enablement. When Revnet is disabled, wallet presence must not gate invite/auth stage resolution.
- Do not move Linq or Telegram routing in this lane.
- Do not move Stripe refs in this lane.

Goals:

- Refactor request auth to resolve hosted members through `HostedMemberIdentity`.
- Refactor Privy completion and onboarding reconciliation to use `privyUserId` and `phoneLookupKey` from the identity table.
- Fix invite/auth stage logic so non-Revnet flows no longer require both `privyUserId` and `walletAddress` to count as “has identity”.
- Preserve user-facing errors unless a simplification is clearly better and still consistent.

Primary files:

- `apps/web/src/lib/hosted-onboarding/request-auth.ts`
- `apps/web/src/lib/hosted-onboarding/authentication-service.ts`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-service.ts`
- focused tests under `apps/web/test/hosted-onboarding-*`

Acceptance:

- Auth and onboarding read identity from the new identity table/helper surface.
- Non-Revnet auth stage logic no longer treats wallet presence as mandatory identity state.
- Product behavior stays otherwise aligned.
