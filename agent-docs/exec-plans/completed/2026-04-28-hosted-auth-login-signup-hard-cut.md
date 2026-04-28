Goal (incl. success criteria):
- Hard-cut hosted public auth to one "Log in or sign up" flow.
- Remove the public/backend sign-in-only intent path while preserving invite-bound safety and identity conflict checks.

Constraints/Assumptions:
- No schema cleanup in this task.
- Preserve unrelated dirty work in the current checkout.
- Auth/session behavior is high-sensitivity; keep server-side Privy verification and fail-closed identity conflict handling.

Key decisions:
- Non-invite Privy completion always resolves or creates a hosted member.
- Invite completion remains the only special auth branch.
- Link/settings flows remain separate from public auth.

State:
- Focused verified; scoped commit requested after bug audit.

Done:
- Reviewed hosted auth backend and frontend intent surfaces.
- Removed public/backend sign-in-only Privy completion intent.
- Collapsed landing/sidebar auth UI to one login-or-signup action.
- Kept Linq invite replies on signup copy; new sends only create `invite_signup`, with legacy `invite_signin` replay tolerated as the same signup invite reply.
- Neutralized the remaining shared Privy identity-conflict copy from "sign-in session" to "verified session".
- Ran required security/privacy, frontend, simplify, and final-review audit passes.
- Ran three additional read-only bug-audit subagents before commit.
- Verified focused hosted auth and Linq tests plus hosted-web typecheck.

Now:
- Commit the scoped hosted auth hard cut while excluding unrelated dirty work.

Next:
- Handoff with verification and commit details.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/authentication-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/app/api/hosted-onboarding/privy/complete/route.ts`
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/app/auth-controls.tsx`
- Focused hosted auth tests under `apps/web/test/**`
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
