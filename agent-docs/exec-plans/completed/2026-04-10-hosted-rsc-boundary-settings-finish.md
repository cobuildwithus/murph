# Hosted RSC Boundary Settings Finish

## Goal

Finish the remaining hosted web RSC boundary cleanup after the share/join shell split landed, with the remaining owned work focused on settings device sync server prefetch, billing client-island trim, and related test/verification integration.

## Scope

- `apps/web/app/settings/page.tsx`
- `apps/web/src/components/settings/**`
- `apps/web/src/lib/device-sync/settings-service.ts`
- targeted `apps/web/test/**`
- coordination/commit artifacts for this lane only

## Constraints

- Preserve the already-landed share/join cleanup and unrelated concurrent work.
- Do not change hosted auth semantics or route contracts.
- Keep billing/device-sync browser-only logic inside the smallest practical client leaves.

## Remaining Work

1. Finish integrating the new server-prefetched device-sync settings path.
2. Resolve local type/test fallout from the split components.
3. Run the required hosted-web verification and audit passes.
4. Close this follow-up plan and commit only the settings-side remainder plus required plan/ledger artifacts.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
