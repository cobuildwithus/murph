# Remove Stale Device Settings UI

## Goal

Delete the unmounted hosted device-sync settings UI and its component-only tests after confirming `/connect` is the current reachable wearables management surface.

## Scope

- Remove stale `apps/web/src/components/settings/hosted-device-sync-settings*` UI files that are not imported by current app routes.
- Remove tests that only cover the unmounted settings component.
- Preserve shared device-sync settings service/surface helpers, API routes, `/connect`, sidebar status, completion, and home onboarding behavior.
- Update the feature audit tracker so deleted stale rows are no longer counted as dead features.

## Verification Plan

- Static import search for deleted symbols/paths.
- Focused hosted web tests for `/settings`, `/connect`, device-sync API/service/surface, completion, consent gate, and sidebar/home callers.
- `pnpm typecheck`.

## State

- Done: confirmed `/settings` only links to `/connect`; `/connect` and shared device-sync service/surface remain live.
- Done: removed unmounted hosted device-sync settings component files and component-only tests.
- Done: removed the two stale feature tracker rows and retargeted remaining evidence to `/connect`/API/service surfaces.
- Done: security/privacy review found no medium-or-higher findings.
- Done: coverage-write added focused `/connect` callback-error branch proof.
- Done: focused tests, `pnpm typecheck`, `pnpm test:diff`, stale-reference scans, and `git diff --check` passed.
- Now: commit the scoped cleanup.
- Next: hand off results.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
