# Route estimate Search Box fallback and proximity fix

Status: completed
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Fix `vault-cli route estimate` text-point resolution so free-text POIs such as beaches, parks, and trailheads resolve reliably and later Search Box lookups inherit route context instead of defaulting to server-IP proximity.

## Success criteria

- Text resolution uses Geocoding first for clearly address-like strings and Search Box first for other free-text place or POI queries, with fallback between them on misses.
- Text route points resolve sequentially so later Search Box lookups receive the last resolved coordinate as `proximity`.
- Coordinate object inputs and coordinate literals still bypass external lookups entirely.
- Focused mocked tests cover address-to-POI fallback, beach/park/trailhead-style free-text lookups, sequential proximity propagation, argv redaction, coordinate bypass, and contour parsing.

## Scope

- In scope:
- `packages/cli/src/mapbox-route*.ts`
- `packages/cli/test/mapbox-route.test.ts`
- narrow coordination-ledger updates for this lane
- Out of scope:
- assistant prompt or provider routing behavior beyond already-landed CLI-caller ownership
- broader Mapbox provider abstraction changes
- live network validation against Mapbox

## Constraints

- Keep the external `vault-cli route estimate` command, schema, and privacy posture unchanged.
- Do not persist route lookup inputs or outputs in Murph state.
- Preserve overlapping CLI and assistant work outside the route-estimation owner files.

## Tasks

1. Patch point resolution policy and sequencing in the CLI-owned Mapbox point resolver.
2. Add focused tests for Search Box fallback, free-text POIs, contextual proximity propagation, coordinate bypass, and elevation parsing.
3. Run truthful route-owner verification and direct scenario proof.
4. Complete required audit passes and land a scoped commit.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run packages/cli/test/mapbox-route.test.ts --config packages/cli/vitest.workspace.ts`
- `pnpm test:diff packages/cli/src/mapbox-route.ts packages/cli/src/mapbox-route-points.ts packages/cli/src/mapbox-route-contracts.ts packages/cli/test/mapbox-route.test.ts`

## Outcome

- `packages/cli/src/mapbox-route-points.ts` now resolves route points sequentially, prefers Geocoding only for clearly address-like text, and passes the last resolved coordinate into later Search Box lookups through `proximity`.
- `packages/cli/test/mapbox-route.test.ts` now covers address-to-beach resolution, park/trailhead proximity propagation, non-walking POI Search Box use, Search Box and Geocoding fallback in both directions, coordinate-input proximity seeding, numeric POI handling, coordinate bypass, and contour parsing.
- Focused direct proof passed: `pnpm exec vitest run packages/cli/test/mapbox-route.test.ts --config packages/cli/vitest.workspace.ts`.
- `pnpm typecheck` remained red for unrelated pre-existing `apps/web/test/join-invite-client.test.ts` errors outside this route slice.
- `bash scripts/workspace-verify.sh test:diff packages/cli/src/mapbox-route.ts packages/cli/src/mapbox-route-points.ts packages/cli/src/mapbox-route-contracts.ts packages/cli/test/mapbox-route.test.ts` remained red for unrelated pre-existing type errors in `packages/cli/src/commands/experiment.ts:96` and `packages/cli/src/commands/food.ts:185`.
Completed: 2026-04-10
