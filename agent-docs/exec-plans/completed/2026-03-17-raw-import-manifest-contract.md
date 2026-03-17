# Raw Import Manifest Contract

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Replace duplicated CLI-local raw import manifest schemas with one contracts-owned manifest contract shared by `packages/core` and `packages/cli`.

## Success criteria

- `packages/contracts` exports the canonical raw import manifest schema/type.
- `packages/core` authors manifests against the shared contract instead of private interface copies.
- CLI manifest readers/results use the shared contract and no longer keep permissive local shadow schemas.
- Tests cover the tightened manifest shape without changing command envelopes or follow-up command behavior.

## Scope

- In scope:
- add a shared raw import manifest contract export in `packages/contracts`
- adopt the shared type/schema in `packages/core/src/operations/raw-manifests.ts`
- replace CLI-local raw manifest schemas in document/meal and export/intake helpers
- adjust focused tests to assert the stricter manifest payload shape
- Out of scope:
- changing command names, CLI envelopes, or non-manifest export-pack schemas
- redesigning provenance payload semantics beyond matching the current emitted JSON contract

## Constraints

- Keep validation at least as strict as today and tighten it where the emitted manifest is already narrower.
- Prefer deleting duplicated schema definitions instead of trying to keep them aligned manually.
- Preserve current manifest follow-up command output structure and error codes.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused checks: targeted core/CLI Vitest runs as needed during implementation
