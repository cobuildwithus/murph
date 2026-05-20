# Clawpatch Low-Severity Follow-Ups

## Goal

Fix the remaining low-severity Clawpatch findings with the smallest durable changes:

- Treat malformed hosted connect provider config as a server/runtime configuration failure.
- Preserve device-sync settings-source context in per-connection status responses.
- Make the Signals page display secondary-only days and include body-state history.
- Count all tracked experiments in overview summary metrics, not only visible rows.

## Constraints

- Keep the architecture simple and composable; prefer local helpers and existing surfaces over new layers.
- Do not expose secrets, local paths, personal identifiers, raw health payloads, or provider credentials.
- Preserve existing active work and avoid unrelated refactors.

## Working Set

- `apps/web/app/api/connect-sources/[sourceId]/start/route.ts`
- `apps/web/app/api/settings/device-sync/connections/[connectionId]/status/route.ts`
- `apps/web/app/(dashboard)/signals/page.tsx`
- `apps/web/app/(dashboard)/overview/page.tsx`
- `packages/query/src/browser-replica/**`
- Focused `apps/web/test/**` coverage for the changed behavior.

## Verification Plan

- Focused app tests for the changed API routes and dashboard pages.
- Focused query tests for browser-vault overview experiment summary behavior.
- `bash scripts/workspace-verify.sh test:diff ...` for touched files if it remains truthful.
- `pnpm typecheck` or the required app verification lane if the scoped diff lane is not sufficient.
- `git diff --check`.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
