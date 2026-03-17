# Web home chrome simplify

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Strip the homepage down so the main view foregrounds profile, notes, measurements, and activity rather than technical/operator framing.

## Success criteria

- The homepage no longer shows technical chrome such as the status strip or excessive system-language framing.
- The first screen stays easy to scan and keeps the core health data sections visible.
- Focused web tests/build still pass, or any failing broader repo checks are clearly unrelated.

## Scope

- In scope:
- simplify homepage copy and information hierarchy
- remove or tone down technical metadata from the header and cards
- update homepage render assertions as needed
- Out of scope:
- changing the data model or overview loader
- non-home web routes or the active RHR page work

## Constraints

- Keep the app local-only and read-only.
- Preserve adjacent edits from overlapping web lanes.

## Verification

- `pnpm --dir packages/web test`

## Verification results

- `pnpm --dir packages/runtime-state build && pnpm --dir packages/contracts build && pnpm --dir packages/web test` passed
- Root required checks are currently blocked outside this homepage-only diff:
- `pnpm typecheck` fails in `packages/contracts/scripts/{generate-json-schema,verify}.ts` because `@healthybob/contracts/schemas` is unresolved
- `pnpm test` fails during `packages/web` typecheck because `@healthybob/query` is unresolved and the overlapping RHR lane currently leaves `packages/web/src/lib/rhr.ts` and `packages/web/src/lib/overview.ts` in a broader red state
- `pnpm test:coverage` fails in the same `packages/web` typecheck path
Completed: 2026-03-17
