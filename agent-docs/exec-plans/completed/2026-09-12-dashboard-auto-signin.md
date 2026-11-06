# Automatic sign-in for dashboard links

Status: completed
Created: 2026-09-12

## Outcome and scope

Signed-out dashboard visits open the existing sign-in dialog automatically.
Successful sign-in returns dashboard-accessible members to the current URL.
Reuse the root auth provider and Next route group; no new session or redirect store.
Public routes and existing onboarding/consent authority keep their current behavior.

## Product UX

Effort: Patch.
Reaches: signed-out direct and client-side dashboard visits on phone and desktop;
signed-in visitors; unavailable auth; dismissal and manual reopening; incomplete onboarding.
Proof: provider interaction tests for opening, dismissal, navigation, stage-aware completion,
and public routes; real browser rendering on dashboard pages at mobile and desktop widths.
Done when the dialog is usable without finding a hidden login control and completion preserves
path, query, and anchor for members allowed into the dashboard.

## Tasks

1. Confirm existing signed-out layout and completion behavior.
2. Add dashboard-scoped automatic prompt and URL resumption at the existing owner.
3. Run focused tests, web typecheck, browser evidence, and complexity review.
4. Review privacy and diff, add changelog, close plan and commit.

## Verification

- Focused Vitest: auth-dialog-provider (44), dialog loading/recovery and dashboard
  layout (11), changelog-page (10), shared auth runtime (3): all passed.
- Commands: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage`
  with the six affected test files; changelog generation ran before its test.
- `pnpm --dir apps/web typecheck` and final `typecheck:prepared`: passed.
- ESLint on all changed TS/TSX files: passed.
- `pnpm complexity:diff`: passed, no functions above threshold; source maximum
  remains 15. `git diff --check`: passed.
- Chromium dashboard proof passed at 390px and 1440px, including keyboard
  dismissal, phone input, contained focus, preserved public entry, and desktop
  sidebar navigation. Existing public-auth and experiment-image regressions are
  also exercised through the standard Playwright smoke config.
- Browser screenshots were inspected locally. Existing production auth-form
  catalog: `/design?tab=components#homepage-auth-transitions`; actual route
  interaction proof uses `/patterns` and `/home`.
- Browser proof deliberately blocks external provider traffic; no verification
  message is sent. Auth completion navigation is proven through the provider's
  existing completion callback, not a live account login.
- The smoke server reports an invalid-element SSR fallback on dashboard routes.
  A separate baseline request with the unchanged auth provider reproduced it;
  Chromium recovers to usable client rendering. Recorded in Frog entry
  `20260912202940-dashboard-smoke-rendering`.
- No new redirect store, auth owner, dependency, server boundary, or data access.
  Final external review is not required for this frontend interaction change.
Frontend interaction only: no auth enforcement, server, persistence, or provider changes.

## Completion

Product UX: Ready for the requested automatic prompt and same-page completion.
All 7 Chromium browser checks passed, including the two adjacent regression specs.
Parent review confirmed dashboard scope, dismissal, public routes, session status,
onboarding, current-URL resumption, privacy, and reuse of the existing dialog.
Changelog: `2026-09-12/dashboard-link-sign-in`.
Local scoped commit only; no push, PR, production mutation, or deployment.
Updated: 2026-09-12
Completed: 2026-09-12
