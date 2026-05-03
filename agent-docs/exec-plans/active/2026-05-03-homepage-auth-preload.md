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
in_progress

Done:
Read repo workflow, frontend, security, verification, and relevant skill guidance.
Confirmed direct patch application fails and inspected the visible patch hunks.

Now:
Port the auth preload implementation and focused tests.

Next:
Run focused apps/web tests, typecheck/verification, required audits, privacy/diff checks, then close the plan and create a scoped commit if the dirty tree allows it.

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
