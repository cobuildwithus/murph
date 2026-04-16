## Goal

Add a local-only Playwright stress helper for hosted onboarding routes so an operator can reuse a signed-in browser session without sharing cookies in chat.

## Scope

- `apps/web/scripts/**`
- `apps/web/package.json`
- workspace dependency manifest + lockfile only if Playwright must be added

## Constraints

- Keep credentials local to the operator machine.
- Avoid production runtime changes.
- Keep the helper explicit and local-only rather than folding it into normal app behavior.

## Verification

- `pnpm --dir apps/web typecheck`
- a direct script help / dry-run check if Playwright install allows it
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
