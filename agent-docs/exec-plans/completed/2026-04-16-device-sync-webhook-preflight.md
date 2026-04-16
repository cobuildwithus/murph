## Goal

Hard-cut the shared device-sync webhook verification seam to a provider-owned webhook preflight API that preserves current Oura verification behavior while keeping generic ingress code provider-agnostic.

## Scope

- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/src/webhook-verification.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/http.ts`
- `apps/web/app/api/device-sync/webhooks/[provider]/route.ts`
- focused `packages/device-syncd/**` and `apps/web/**` webhook tests

## Constraints

- Keep provider-specific branching out of shared route/ingress code.
- Preserve normal webhook parse, trace, dedupe, and account-lookup behavior after preflight.
- Preserve current Oura verification behavior as a provider-owned client of the new seam.
- Do not implement new providers or broader config/factory cleanup in this lane.

## Verification

- `pnpm typecheck`
- Focused truthful diff-aware verification for touched `packages/device-syncd` and `apps/web` surfaces
- Focused webhook tests covering Oura verification, POST flow, and unhandled preflight fallthrough
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
