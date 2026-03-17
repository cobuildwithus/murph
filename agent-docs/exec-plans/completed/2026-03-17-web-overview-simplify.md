# Web overview simplify

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Make the local web observatory visibly surface demo-vault data on first load and simplify the overview UI so the most useful information is immediately readable.

## Success criteria

- Running the web app against `fixtures/demo-web-vault` shows concrete profile, journal, event, and sample data without the user needing to guess where it is.
- The home view is simpler and denser than the current version while preserving the local-only, read-only safety constraints.
- Web-focused tests/build still pass, or any failing required check is shown to be unrelated.

## Scope

- In scope:
- inspect and fix the web overview read path if the demo fixture is not being surfaced
- simplify the homepage information architecture and component styling
- adjust or add focused web tests for the new overview behavior
- widen the exact Next.js `next-env.d.ts` allowlist just enough to accept both framework-generated build and dev stubs
- Out of scope:
- CLI/runtime assistant work
- changing canonical fixture contents unless the read-path bug requires it

## Constraints

- Keep the web app localhost-only and read-only.
- Do not expose raw vault paths or other direct identifiers in the rendered payload.
- Preserve adjacent edits from other in-flight lanes.

## Verification

- `pnpm --dir packages/web test`
- `HEALTHYBOB_VAULT=fixtures/demo-web-vault pnpm web:build`
- repo required checks after implementation

## Verification results

- `pnpm --dir packages/web test` passed
- `HEALTHYBOB_VAULT=fixtures/demo-web-vault pnpm web:build` passed
- Root required checks are currently blocked outside this lane:
- `pnpm typecheck` fails in `packages/core/src/mutations.ts`
- `pnpm test` fails in `packages/contracts/dist/scripts/verify.js` due stale generated schema artifacts
- `pnpm test:coverage` fails in the same contracts schema-artifact audit path
Completed: 2026-03-17
