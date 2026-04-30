Goal (incl. success criteria):
- Stop the post-Stripe `/join/[inviteCode]/success` happy path from flashing the hosted invite sidebar or success UI.
- Keep checkout-session reconciliation and redirect-to-`/home` behavior intact.
- Show visible UI only for preview, errors, terminal invite states, auth/session mismatch, missing session id, or delayed pending setup.

Constraints/Assumptions:
- Preserve Stripe's existing success URL path for now.
- Do not edit the shared hosted invite shell; other active work owns related layout files.
- No new persisted state.

Key decisions:
- Treat `/join/[inviteCode]/success` as a bare callback/bridge route, not a full hosted invite page.
- Remove `JoinInviteShell` from the success page and let the client return `null` during silent bridge states.

State:
- Implementation and required reviews complete.

Done:
- Read routed docs, frontend guidance, and relevant success-route code.
- Added a success-route-only blank layout that hides the root footer.
- Removed the hosted invite shell from the success page.
- Added success-client gating so normal returned-session states render no UI while reconciliation/redirect runs.
- Updated focused success-client coverage for the blank bridge state.
- Focused success-client/page tests passed.
- Hosted-web typecheck passed.
- Diff-aware hosted-web verification passed, including build, lint, and hosted-web tests.
- Security/privacy review passed with no findings.
- Frontend review finding about the missing `layout.tsx` working-set entry was fixed.
- Final completion review passed with no findings.

Now:
- Close the active plan/ledger row and commit if safe.

Next:
- Handoff with verification and any commit/dirty-tree constraints.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/app/join/[inviteCode]/success/layout.tsx`
- `apps/web/app/join/[inviteCode]/success/page.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-success-client.tsx`
- `apps/web/test/join-invite-success-client.test.ts`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
