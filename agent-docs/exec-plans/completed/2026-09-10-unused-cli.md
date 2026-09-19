# Remove unused environment and CLI machinery

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Remove the unused process.env proxy, unreachable assistant-method wizard screen, lifecycle command factory and unused ledger registration wrapper, old food cron helpers, and orphan investigation script. Preserve provider-derived assistant method selection, live registry/artifact factories, and canonical daily scheduled food logs.

## Evidence and design

Repository reference searches show no production consumers for the removed APIs. The method-required predicate always returned false and the options list was empty. Delete the screen and its navigation state; retain the existing provider/selection resolver. No replacement owner, schema, state migration, external effects, or runtime protocol change.

## Tasks and proof

1. Remove proven unused code and exclusive tests/mocks; update runtime-state architecture inventory.
2. Run focused setup keyboard/selection, food scheduled-log, factory, and runtime-state entrypoint tests plus relevant package typechecks.
3. Inspect the full diff and complexity guard, then commit and open a draft PR.
4. Admit the stable candidate to required CI and ReviewGPT concurrently.

## Verification and candidate review

Focused setup selection and wizard interaction tests, canonical food scheduled-log and public entrypoint tests, CLI factory coverage, and three assistant cron suites pass. Typechecks pass for runtime-state, setup-cli, vault-usecases, and CLI. The final setup typecheck and seven runtime-state package-boundary tests also pass. `pnpm complexity:diff` passes; remaining setup screen hotspots (39 and 25) are existing live interactive state handling, with measured debt reduced from 33 to 24.

Parent review checked all changed paths and references, retained method inference and provider resolution, and confirmed live registry/artifact registration remains. No new product logic or runtime effects. Internal-only cleanup needs no member-visible changelog. Exact-head CI and final ReviewGPT remain PR gates.
Completed: 2026-09-10
