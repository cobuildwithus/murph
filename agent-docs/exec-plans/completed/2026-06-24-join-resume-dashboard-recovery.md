Goal (incl. success criteria):
- Replace dashboard-layout-owned onboarding recovery with a simple page-level redirect to `/join`.
- Add `/join` as the logged-in session resume route that reuses or creates the member's existing web invite and redirects to `/join/<inviteCode>`.
- Success means incomplete hosted members cannot enter dashboard page loaders, the existing invite-based onboarding UI remains the single checkout surface, and the dashboard-specific recovery API/state is deleted.

Constraints/Assumptions:
- Keep `/join/<inviteCode>` as the canonical external invite entry path for SMS, Linq, and share links.
- Do not fork the onboarding UI or add a second session-native checkout model.
- Reuse `issueHostedInvite`, which already finds the latest unexpired invite before creating one.
- Keep invite issuance idempotent and authenticated; no user-visible messages are sent by `/join`.
- Preserve unrelated active ledger rows and working-tree edits.

Key decisions:
- Use `/join` as the resume redirect target from dashboard pages, not a dashboard-specific POST route.
- Keep layout/sidebar auth state presentational only; page access remains page-owned.
- Prefer one shared dashboard guard helper over duplicating recovery checks in every page.

State:
- Ready to commit.

Done:
- Confirmed `issueHostedInvite` already reuses unexpired invites.
- Confirmed Privy completion already uses the same invite primitive for session-created members.
- Added `/join` as the authenticated session resume route.
- Added the shared dashboard page auth guard and applied it to dashboard page entrypoints before page-specific loaders.
- Removed the layout/sidebar recovery flag, client recovery component, and dashboard recovery API route.
- Updated focused and broad web tests for the new route and guard.
- Verification passed: focused Vitest, `pnpm --dir apps/web lint`, `pnpm test:diff`, and `pnpm typecheck`.

Now:
- Commit and open a draft PR.

Next:
- Push the branch and open a draft PR.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/join/page.tsx
- apps/web/app/(dashboard)/**/page.tsx
- apps/web/src/lib/hosted-onboarding/page-auth.ts
- apps/web/src/lib/hosted-onboarding/sidebar-auth.ts
- apps/web/src/lib/hosted-onboarding/invite-service.ts
- apps/web/src/components/dashboard/dashboard-shell.tsx
- apps/web/src/components/dashboard/dashboard-onboarding-recovery.tsx
- apps/web/app/api/hosted-onboarding/session/dashboard-recovery/route.ts
- apps/web/test/*
- pnpm exec vitest run --config apps/web/vitest.config.ts <focused tests>
- pnpm typecheck
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
