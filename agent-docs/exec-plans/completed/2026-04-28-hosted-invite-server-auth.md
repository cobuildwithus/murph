Goal (incl. success criteria):
- Fix the hosted invite join flow so checkout is shown only after the server-side invite status confirms the browser session belongs to the invite.
- Prevent client-side Privy completion payloads from promoting the join UI directly into checkout.

Constraints/Assumptions:
- Preserve unrelated dirty work in the current checkout.
- Hosted member identity, invite ownership, and checkout eligibility remain server-authoritative.
- Client Privy state may be used to drive Privy SDK actions, but not as Murph authorization proof.

Key decisions:
- After phone verification completes, `/api/hosted-onboarding/privy/complete` returns the server-computed invite status from the same service used by `/api/hosted-onboarding/invites/:inviteCode/status`.
- The join client renders only that server status payload after SMS verification; it no longer derives authenticated/matched checkout state from client-side Privy completion fields.

State:
- Completed; not committed because the checkout had overlapping pre-existing dirty edits in related hosted onboarding test/copy files and unrelated active work.

Done:
- Identified client-side stage promotion as the likely source of the transient checkout button followed by `AUTH_REQUIRED`.
- Removed the client-side invite-auth promotion helper and the client `authenticated` prop.
- Added route response coverage for the server status payload and a regression test that keeps checkout hidden when the server status still says the invite session is unresolved.
- Ran focused hosted onboarding tests, diff whitespace check, and `apps/web` typecheck successfully.

Now:
- Closed after required reviews.

Next:
- Land with a scoped commit once overlapping dirty work is separated or intentionally included.

Open questions (UNCONFIRMED if needed):
- Whether the production report also involves stale browser cookies after repeated account deletion.

Working set (files/ids/commands):
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- `apps/web/app/join/[inviteCode]/page.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-client.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-sections.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-state.ts`
- `apps/web/src/lib/hosted-onboarding/types.ts`
- `apps/web/test/join-invite-client.test.ts`
- `apps/web/test/hosted-onboarding-privy-complete-route.test.ts`
- `apps/web/test/hosted-onboarding-routes.test.ts`
- `agent-docs/exec-plans/completed/2026-04-28-hosted-invite-server-auth.md`
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
