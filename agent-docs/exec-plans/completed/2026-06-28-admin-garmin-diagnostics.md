Goal (incl. success criteria):
- Add an admin/runtime-ops path to run safe Junction Garmin diagnostics for a selected hosted member without impersonating that member.
- Success means an admin can trigger the existing Junction matrix-style diagnostic for a member's Garmin source, see only counts/status/window metadata, and never receive raw provider records, tokens, external account ids, source provider slugs, or raw health payloads.

Constraints/Assumptions:
- `apps/web` remains the hosted device-sync control-plane owner.
- Admin authority must be checked server-side and must not rely on the member's browser session.
- Reuse the existing Junction diagnostic logic and redaction where possible.
- Preserve existing member-scoped settings diagnostics behavior.
- Keep the UI operational and dense; avoid adding decorative/dashboard-heavy surfaces.

Key decisions:
- Extract the existing member-scoped backfill diagnostic logic into a shared server-only runner.
- Add a dedicated ops POST endpoint that is admin-allowlisted, same-origin protected, feature-flag gated outside localhost, and target-member aware.
- Return a compact Garmin summary to the ops UI instead of the full diagnostic payload.

State:
- Verification passed; ready to archive plan and commit.

Done:
- Read routing, security, frontend, device-sync, and coordination docs.
- Created isolated task worktree.
- Added a shared hosted device-sync backfill diagnostic runner for the existing member-scoped settings route.
- Added an admin-only Garmin/Junction diagnostic POST route that accepts a target member id after ops allowlist auth.
- Added a runtime maintenance UI form/result panel that displays counts, statuses, resource names, and windows only.
- Added focused route coverage for the admin diagnostic response redaction.
- Ran focused route tests, web typecheck, and `pnpm test:diff`.
- Scanned changed files for accidental local identifiers, secrets, and screenshot/user ids.

Now:
- Archive plan and create scoped commit.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/ops/runtime-maintenance/runtime-maintenance-client.tsx
- apps/web/app/api/ops/device-sync/garmin-diagnostics/route.ts
- apps/web/app/api/settings/device-sync/diagnose-backfill/route.ts
- apps/web/src/lib/device-sync/backfill-diagnostic.ts
- apps/web/src/lib/hosted-ops/device-sync-diagnostic-types.ts
- apps/web/src/lib/hosted-ops/device-sync-diagnostics.ts
- apps/web/test/hosted-ops-device-sync-diagnostics.test.ts
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test:prepared apps/web/test/hosted-ops-device-sync-diagnostics.test.ts apps/web/test/device-sync-settings-routes.test.ts`
- `pnpm test:diff`
Status: completed
Updated: 2026-06-28
Completed: 2026-06-28
