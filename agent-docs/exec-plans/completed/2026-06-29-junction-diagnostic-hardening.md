# Junction diagnostic hardening

## Goal

Resolve the accepted PR review findings for hosted ops Junction source diagnostics.

Success criteria:

- Source-specific diagnostics run only for source slugs present on the selected Junction connection.
- Admin output makes connection-wide backfill scope explicit.
- The diagnostic route flag cannot be bypassed by a production request URL host.
- Production env setup documents `DEVICE_SYNC_BACKFILL_DIAGNOSTIC_ENABLED=true`.
- Focused tests and typecheck pass before handoff.

## Constraints

- Keep the architecture provider-generic; do not add a hosted-only provider registry.
- Do not return raw Junction/provider payloads, source slugs from provider diagnostics, account ids, secrets, or direct personal identifiers.
- Preserve the existing member settings diagnostic route behavior except for failing closed on invalid requested source slugs.
- Keep edits scoped to the existing PR branch.

## Approach

1. Validate requested REST diagnostic source slugs against the selected connection source projection before provider probes.
2. Add an explicit all-source scope marker to the admin backfill summary and update the UI label.
3. Restrict localhost diagnostic-route bypass to non-production runtimes.
4. Add focused regressions for invalid source slugs and production localhost gating.
5. Run focused route tests, app typecheck, and the diff test lane.

## State

Implementation complete; closing through `scripts/finish-task`.

## Notes

- This is a follow-up hardening pass on PR #338.
- Verification passed:
  - `pnpm --dir apps/web test:prepared apps/web/test/hosted-ops-device-sync-diagnostics.test.ts apps/web/test/device-sync-settings-routes.test.ts`
  - `pnpm test:diff apps/web/src/lib/device-sync/backfill-diagnostic.ts apps/web/src/lib/hosted-ops/device-sync-diagnostics.ts apps/web/src/lib/hosted-ops/device-sync-diagnostic-types.ts 'apps/web/app/(dashboard)/ops/runtime-maintenance/runtime-maintenance-client.tsx' apps/web/test/hosted-ops-device-sync-diagnostics.test.ts apps/web/.env.example apps/web/README.md`
  - `pnpm --dir apps/web typecheck`
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
