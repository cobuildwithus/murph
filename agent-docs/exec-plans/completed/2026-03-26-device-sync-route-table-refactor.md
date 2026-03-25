# Device Sync Route Table Refactor

## Goal

Refactor `packages/device-syncd/src/http.ts` so route existence, route surface (`control` vs `public`), path matching, and decoded path params come from one declarative route table without changing external behavior.

## Scope

- Replace duplicated regex-based route declarations in `routeRequest(...)` and `classifyDeviceSyncHttpRoute(...)` with shared route descriptors.
- Centralize decoded `provider` and `accountId` path params so handlers consume parsed values instead of re-decoding.
- Preserve control-route auth/loopback behavior, callback redirect semantics, webhook verification/acceptance behavior, and the existing 404 JSON payload format.
- Keep the change local to `packages/device-syncd/src/http.ts` and focused `packages/device-syncd/test/http.test.ts` coverage unless a tiny adjacent helper change is unavoidable.

## Constraints

- Do not change endpoint paths, methods, payload shapes, status codes, or `WWW-Authenticate` behavior.
- Keep the public listener restricted to the existing callback and webhook routes.
- Preserve overlap-safe behavior with in-flight `packages/device-syncd` work; no broad control-plane redesign.

## Verification Plan

- Run completion workflow audit passes after the functional refactor lands.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Run focused `packages/device-syncd/test/http.test.ts` coverage during development as the fast signal.
