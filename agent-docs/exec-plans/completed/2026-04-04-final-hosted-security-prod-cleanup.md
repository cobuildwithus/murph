# Final Hosted Security Prod Cleanup

## Goal

Land the final hosted security cleanup patch on top of the current hosted snapshot while preserving newer in-tree changes.

## Scope

- Remove remaining hosted share acceptance leak paths so outbox payloads store share acceptance by reference and hosted share fetches use `shareId` only.
- Keep opaque hosted storage paths rotation-safe through the shared helper already used by Cloudflare storage readers/writers.
- Tighten hosted device-sync encryption key parsing to encoded 32-byte keys only.
- Remove stale per-surface hosted web base-url overrides and keep the worker/web control plane on the shared hosted web base URL.
- Add or update focused regression tests for confidentiality, path rotation, and parsing behavior.

## Constraints

- Treat the supplied patch as intent only; the uploaded hunks no longer apply cleanly against the live tree.
- Preserve unrelated dirty-tree edits and active hosted/runtime lanes.
- Keep the change in scope: no broader hosted architecture rewrite.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`

## Status

- In progress
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
