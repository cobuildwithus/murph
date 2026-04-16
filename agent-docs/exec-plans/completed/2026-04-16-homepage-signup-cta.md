# Add Signup CTA Above Quick Start

## Goal

Add a dedicated signup CTA section above the landing page quick-start block, echoing the older homepage's mid-page conversion prompt without regressing the newer `/lp` design.

## Why

- The current landing page jumps from FAQ straight into the install command.
- There is no mid-page conversion block that catches readers who are interested but not yet ready for the CLI quick start.
- Reusing the shared hosted auth dialog keeps signup behavior consistent instead of creating another homepage-only auth variant.

## Scope

- `apps/web/app/lp/page.tsx`
- `apps/web/app/lp/auth-controls.tsx`
- Focused `apps/web/test/*lp*` updates for landing-page render expectations.

## Guardrails

- Keep the `/lp` visual language and information hierarchy intact.
- Reuse existing hosted signup dialogs; do not introduce a second auth implementation.
- Keep the diff narrow and avoid unrelated homepage copy rewrites.

## Verification target

- Focused `apps/web` landing/auth tests for the new CTA section and auth-control wiring.
- One direct local proof step for the landing route after the UI change is in place.

## Current status

- Added a new mid-page signup CTA above quick start on `apps/web/app/lp/page.tsx`.
- Kept the CTA on the shared `LandingAuthActions` dialog path instead of introducing another auth surface.
- Frontend review flagged an authenticated-state mismatch in the CTA copy; fixed by making the section copy and metadata row state-aware and by adding authenticated render coverage.

## Verification run

- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/page.test.ts test/lp-page.test.ts test/lp-auth-controls.test.tsx --no-coverage`
- Passed: `pnpm --dir apps/web dev:smoke`
- Failed, unrelated pre-existing issue: `pnpm --dir apps/web typecheck` due `src/lib/hosted-onboarding/authentication-service.ts(183,9)`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
