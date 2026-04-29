Goal (incl. success criteria):
- Speed up dashboard sidebar initial auth rendering by adding a lightweight server snapshot and threading it from `(dashboard)/layout.tsx` through `DashboardShell` to `Sidebar`.
- Parallelize independent full page-auth member reads where safe.

Constraints/Assumptions:
- Do not expose tokens, raw sessions, full member rows, or secrets to client components.
- Keep Privy client hooks as the post-hydration live source for login/logout changes.
- Preserve unrelated dirty work in the current checkout.

Key decisions:
- Add a sidebar-specific snapshot rather than using the full hosted page auth snapshot for sidebar UI.
- Use the full page auth helper only where member-backed state is actually required.

State:
- Completed; scoped commit blocked by pre-existing overlapping dirty ledger/worktree state.

Done:
- Read repo routing, verification, frontend, and security docs.
- Added lightweight sidebar auth snapshot and threaded it through every current `DashboardShell` layout.
- Parallelized full member auth lookup/read path.
- Added focused sidebar, page-auth, and request-auth coverage.
- Completed frontend, security/privacy, coverage-write, and final review passes; addressed findings.

Now:
- Closing plan.

Next:
- Handoff with verification evidence and commit blocker.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/page-auth.ts`
- `apps/web/src/lib/hosted-onboarding/request-auth.ts`
- `apps/web/src/lib/hosted-onboarding/sidebar-auth.ts`
- `apps/web/app/(dashboard)/layout.tsx`
- `apps/web/app/biomarkers/layout.tsx`
- `apps/web/app/measurement-methods/layout.tsx`
- `apps/web/src/components/dashboard/dashboard-shell.tsx`
- `apps/web/src/components/dashboard/sidebar.tsx`
- `apps/web/test/dashboard-sidebar.test.ts`
- `apps/web/test/page-auth.test.ts`
- `apps/web/test/hosted-onboarding-request-auth.test.ts`
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
