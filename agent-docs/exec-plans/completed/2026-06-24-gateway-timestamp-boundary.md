# Gateway Timestamp Boundary

## Goal

Close the audit finding that gateway timestamps accepted offset-less strings and
therefore still depended on host timezone when ordered by instant.

Success criteria:

- Gateway timestamp validation requires explicit `Z` or numeric offset.
- Gateway timestamp comparison uses the same parse primitive as validation.
- Cloudflare gateway permission override state rejects offset-less timestamps.
- Focused tests and required verification pass, then a scoped follow-up commit
  is pushed.

## Constraints

- Keep the fix at the gateway boundary; do not introduce compatibility
  interpretation for offset-less instants.
- Reuse existing gateway contracts and public package entrypoints.
- Do not add new persisted state or runtime migration behavior.

## State

Started 2026-06-24 after completion-audit follow-up on the timestamp ordering
fix.

## Done

- Confirmed `security-privacy-review` found no actionable security/privacy
  finding.
- Accepted the deep-review finding that offset-less gateway timestamps were
  still accepted and host-timezone dependent.
- Accepted the coverage-write test-only proof gaps for core and
  assistant-engine ordering surfaces.
- Added a shared gateway timestamp parse helper and wired validation,
  comparison, and Cloudflare override parsing to it.
- Added gateway and Cloudflare cache-boundary tests for offset-less timestamp
  rejection.
- Ran focused tests, root typecheck, scoped `test:diff`, diff whitespace check,
  privacy scan, and targeted deep-review rerun.

## Now

- Close and push the follow-up commit.

## Next

- None.

## Open Questions

- None.

## Working Set

- `packages/gateway-core/src/shared.ts`
- `packages/gateway-core/src/index.ts`
- `packages/gateway-core/src/snapshot.ts`
- `packages/gateway-core/test/contracts-routes-opaque-ids.test.ts`
- `apps/cloudflare/src/gateway-projection-cache-permissions.ts`
- `apps/cloudflare/test/gateway-projection-cache.test.ts`
- `packages/core/test/core.test.ts`
- `packages/assistant-engine/test/assistant-store-persistence.test.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
