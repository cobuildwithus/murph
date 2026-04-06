## Goal

Hard-cut hosted member privacy state to the greenfield end-state. `HostedMember` becomes entitlement-only, all identity/routing/billing refs move to their split tables, compatibility helpers are deleted, activation/billing/auth read one canonical aggregate shape, and the remaining staged-migration seams are removed.

## Success Criteria

- `HostedMember` keeps only entitlement/control-plane fields plus relations.
- All phone/Privy/wallet/routing/Stripe reads and writes go through `HostedMemberIdentity`, `HostedMemberRouting`, or `HostedMemberBillingRef`.
- Legacy dual-read/dual-write compatibility helpers are removed.
- Activation/billing/auth flows consume one canonical aggregate/member-profile seam.
- `skipIfBillingAlreadyActive` only skips when the member is already active.
- Hosted-web tests and required verification pass.

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/scripts/local-reset-hosted-onboarding.ts`
- hosted-onboarding-related tests under `apps/web/test/**`
- durable docs/proof notes only if the implementation changes their truthfulness

## Constraints

- Greenfield assumption: no existing user data to preserve.
- Preserve unrelated worktree edits.
- Keep verified email out of Postgres.
- Treat auth, billing, wallet, and messaging surfaces as high-risk.

## Verification

- `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- Focused hosted-web Vitest suite covering member store, auth, billing, messaging, and Stripe reconciliation
- `pnpm --dir apps/web lint`

## Notes

- Prefer one final hard-cut migration over carrying staged compatibility.
- Update architecture/proof docs if the deferred hard-cut note is no longer true.
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
