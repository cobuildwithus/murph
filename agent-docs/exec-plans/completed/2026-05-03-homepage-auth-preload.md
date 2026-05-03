Goal (incl. success criteria):
Land the supplied homepage auth preload patch. Homepage auth CTAs should avoid wrapping the first render in Privy, share one cached dynamic import for `HostedAuthPanelIsland`, preload the island on idle/CTA intent, and synchronously install the cached component when already loaded before opening the dialog wait path. Existing join-page eager `HostedPrivyBoundary` behavior should remain unchanged.

Constraints/Assumptions:
The supplied patch file is corrupt for direct `git apply`, so port the visible diff manually and keep the behavioral intent narrow.
This touches hosted auth/client loading behavior in `apps/web`, so treat it as high-risk hosted auth work.
Preserve unrelated dirty checkout work, including active billing-success, metric-cleanup, and generated Next route-stub edits.

Key decisions:
Preload only the auth island module, not a hidden mounted auth panel, to avoid mounting Privy captcha/auth UI before user intent.
Limit idle preloading to homepage CTAs by passing an explicit `preloadAuthPanel` prop from homepage surfaces.

State:
implemented_verified_blocked_by_unrelated_typecheck

Done:
Read repo workflow, frontend, security, verification, and relevant skill guidance.
Confirmed direct patch application fails and inspected the visible patch hunks.
Ported the cached auth island import, CTA intent preload, homepage idle preload prop, and focused test coverage.
Focused Vitest passed for `apps/web/test/lp-auth-controls.test.tsx` and `apps/web/test/page.test.ts`.
Scoped `test:diff` passed dependency/workspace/log guards, hosted-web dev smoke, hosted-web lint, and hosted-web Vitest; it is blocked at `next build` by unrelated `apps/web/app/design/components-content.tsx` `HeartbeatButtonProps.onSuccess` type errors.
Root `pnpm typecheck` is blocked by the same unrelated design showcase `onSuccess` mismatch in the parent run.
Required security/privacy, frontend, coverage-write, and task-finish audit passes completed with no required fixes.
Privacy/identifier scan and `git diff --check` passed for the scoped task files.

Now:
Close this plan and create a scoped commit for the auth preload landing.

Next:
Hand off verification results and the unrelated typecheck/build blocker.

Open questions (UNCONFIRMED if needed):
None.

Working set (files/ids/commands):
apps/web/app/auth-controls.tsx
apps/web/app/page.tsx
apps/web/app/sticky-nav.tsx
apps/web/src/components/homepage/hero-section.tsx
apps/web/src/components/homepage/signup-cta-section.tsx
apps/web/test/lp-auth-controls.test.tsx
apps/web/test/page.test.ts
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
