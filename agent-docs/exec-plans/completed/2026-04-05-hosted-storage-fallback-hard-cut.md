# Hosted Storage Fallback Hard Cut

## Goal

Remove the remaining greenfield-inappropriate hosted storage fallback logic so Cloudflare storage paths and root-key envelopes use only opaque object identifiers.

## Scope

- `apps/cloudflare/src/storage-paths.ts`
- `apps/cloudflare/src/bundle-store.ts`
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/outbox-delivery-journal.ts`
- `apps/cloudflare/src/user-key-store.ts`
- Focused tests under `apps/cloudflare/test/**` that still assert legacy raw-path compatibility

## Constraints

- Preserve bundle-key rotation support through `keysById`.
- Do not touch unrelated hosted legacy cleanup outside the storage/object-key surface.
- Preserve unrelated dirty worktree edits.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused Cloudflare storage-path tests before repo-wide checks

## Status

- In progress
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
