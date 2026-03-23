# Device Sync Public Ingress Extraction

## Goal

Land the reviewed `device-syncd` split prerequisite by extracting reusable public callback/webhook logic into a shared ingress layer and documenting the hosted-control-plane target without changing the current local/tunneled runtime behavior.

## Scope

- Add a reusable `DeviceSyncPublicIngress` core plus its public exports and supporting type contracts.
- Rewire `DeviceSyncService` to compose that ingress instead of owning duplicated callback/webhook logic directly.
- Add focused service coverage for callback handling, webhook dedupe, and inactive-account behavior through the shared ingress seam.
- Update architecture and package/docs guidance with the hosted-control-plane proposal and the new shared-ingress seam.

## Constraints

- Preserve the existing local `device-syncd` control-plane auth/listener behavior and any adjacent in-progress edits.
- Keep vault writes local-only; do not introduce a half-wired hosted runtime or secret-management surface.
- Avoid exposing secrets or local identifiers in docs, tests, logs, or commits.

## Verification Plan

- Run completion workflow audit passes after the functional changes land.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
Status: completed
Updated: 2026-03-23
Completed: 2026-03-23
