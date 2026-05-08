# Browser Vault Session Refresh Latency

Status: completed
Updated: 2026-05-08

## Goal

Keep browser-vault session responses off the refresh-scheduling critical path.

Success criteria:

- Stale or missing replicas still report `refreshPending: true` when a source state hash exists.
- Refresh scheduling remains best-effort and non-fatal.
- Slow Cloudflare control scheduling does not delay returning stale/empty dashboard session responses.

## Scope

- `apps/web/src/lib/browser-vault/session-handler.ts`
- `apps/web/test/browser-vault-session-route.test.ts`

## Constraints

- Do not change browser-vault freshness semantics.
- Do not add new persisted state or a new scheduling abstraction.
- Preserve hosted control-plane error handling for the foreground session fetch path.

## Verification

- Focused browser-vault session route test.
- Required repo verification/audits per workflow after implementation.
Completed: 2026-05-08
