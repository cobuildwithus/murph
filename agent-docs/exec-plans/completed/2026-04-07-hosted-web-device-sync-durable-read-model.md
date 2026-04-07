# Hosted Web Device-Sync Durable Read Model

## Goal

Stop ordinary hosted-web device-sync reads from depending on live Cloudflare runtime snapshots. Settings and other normal hosted-web control-plane reads should come from durable Prisma-owned connection metadata, while explicit operational flows keep using live Cloudflare runtime inspection.

## Why

- Normal hosted-web control-plane pages should not fail or block on Cloudflare runtime health just to render connection state.
- Cloudflare remains the canonical mutable runtime owner for token escrow and live runtime state, but that does not mean every hosted-web read should synchronously hydrate from it.
- The existing store currently calls `getDeviceSyncRuntimeSnapshot()` for both list and single-record reads, which couples ordinary settings reads to the runtime path.

## Scope

- Split hosted-web device-sync connection reads into durable default reads and explicit runtime-hydrated operational reads.
- Update callers so settings/browser reads use durable Prisma metadata, while agent/export/refresh/disconnect/heartbeat/runtime-upkeep paths keep using live runtime reads.
- Update durable docs to state that ordinary hosted-web reads use Postgres-owned metadata and live runtime inspection is operational-only.

## Constraints

- Preserve Cloudflare as the canonical owner for token escrow and mutable runtime state.
- Do not introduce new durable persisted state in this pass.
- Preserve existing opaque browser connection-id behavior and browser redaction rules.
- Preserve unrelated hosted worktree edits.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Direct scenario evidence from focused hosted-web/device-sync tests covering durable settings reads and explicit runtime reads.
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
