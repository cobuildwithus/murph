# Disconnect hosted source projections with their connection

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Fix hosted wearable disconnect state so disconnecting a Junction-backed connection cannot leave stale upstream source rows looking connected or resurrect a previously disconnected source on the Connect page.

## Success criteria

- Disconnecting a hosted device-sync connection marks its associated source projections disconnected in the same mutation boundary.
- Connect and sidebar summaries no longer report stale connected upstream wearables after the owning connection is disconnected.
- Focused tests cover multi-source Junction disconnect behavior without adding a second source-disconnect model.

## Scope

- In scope:
  - Hosted web device-sync connection-source lifecycle.
  - Connect-page and sidebar-visible source state derived from existing source projections.
- Out of scope:
  - Provider-side per-source unlinking in Junction.
  - New product UI for selecting individual Junction upstream sources to unlink.

## Constraints

- Technical constraints:
  - Preserve the existing connection-owned disconnect authority and wake flow.
  - Keep source state as a projection of the owning connection; do not introduce new persisted state.
- Product/process constraints:
  - Health/device state is sensitive; no raw provider payloads, identifiers, secrets, or local paths in logs, tests, docs, or handoff.
  - Preserve unrelated dirty work in the checkout.

## Risks and mitigations

1. Risk:
   Source projection writes could diverge from the connection lifecycle.
   Mitigation:
   Apply source disconnection inside the same locked transaction as the connection disconnect.

## Tasks

1. Add a store-level helper to mark connection source projections disconnected.
2. Call it from the hosted disconnect flow inside the existing connection mutation lock.
3. Add regression tests for multi-source Junction disconnect state and Connect page mapping.
4. Run focused checks, required audits, and commit through the active-plan path.

## Decisions

- Use the existing `DeviceConnectionSource.status = "disconnected"` lifecycle value instead of creating a new per-source disconnect table or UI-only override.

## Verification

- Commands to run:
  - `pnpm --dir apps/web test -- connect-page.test.ts device-sync-settings-surface.test.ts device-sync-hosted-wake.test.ts`
  - `pnpm test:diff apps/web/src/lib/device-sync/wake-service.ts apps/web/src/lib/device-sync/prisma-store/sources.ts apps/web/app/(dashboard)/connect/page.tsx apps/web/test/connect-page.test.ts apps/web/test/device-sync-settings-surface.test.ts apps/web/test/device-sync-hosted-wake.test.ts`
  - `pnpm typecheck`
- Expected outcomes:
  - Tests and typecheck pass, or any unrelated pre-existing failure is named with evidence.
Completed: 2026-05-26
