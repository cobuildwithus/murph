## Goal

Remove the full hosted-member identity fan-out from the invite-status poll route while preserving the current `authenticated` and `matchesInvite` semantics.

## Scope

- `apps/web/app/api/hosted-onboarding/invites/[inviteCode]/status/route.ts`
- narrow auth/helper support under `apps/web/src/lib/hosted-onboarding/**` only if needed for the route
- focused `apps/web/test/hosted-onboarding-privy-invite-status.test.ts`
- focused `apps/web/test/hosted-onboarding-invite-status-route.test.ts`

## Constraints

- Do not broaden into share-status, page-auth, or checkout-success work in this lane.
- Preserve current invite-status behavior: `session.authenticated` should still track whether a verified Privy session exists, while `session.matchesInvite` should remain the invite-member check.
- Avoid inspecting or logging env contents.
- Preserve unrelated hosted-onboarding work already in the tree.

## Verification

- Focused invite-status tests for the lightweight-auth path, including rotation-safe lookup-key matching
- `apps/web` typecheck
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
