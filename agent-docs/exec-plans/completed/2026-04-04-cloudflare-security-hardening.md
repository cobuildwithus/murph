# Cloudflare Security Hardening Patch Landing

## Goal

Land the supplied Cloudflare security hardening patch onto the current repo while preserving unrelated dirty-tree work and current hosted-runtime/device-sync behavior.

## Why this exists

The patch spans high-sensitivity hosted storage, Durable Object queue persistence, hosted email cleanup, device-sync token escrow, Prisma schema, tests, and durable docs. The current tree already has overlapping hosted-runtime and device-sync edits, so this needs an explicit port plan instead of a blind patch apply.

## Guardrails

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve adjacent dirty-tree edits and active hosted/runtime lanes.
- Keep secrets, identifiers, and raw payloads out of logs and persisted plaintext storage.
- Update architecture/docs with any trust-boundary or retention changes introduced by the landing.
- Run the full required verification baseline unless the environment makes that impossible for a clearly unrelated reason.

## Intended scope

- `apps/cloudflare`: opaque object keys, encrypted off-row dispatch payload storage, lifecycle/cleanup updates, queue/journal plumbing, and focused confidentiality tests
- `apps/web`: device-sync escrow crypto hardening, audit persistence, Prisma schema/migration, and focused tests
- `ARCHITECTURE.md` plus hosted Cloudflare docs for durable storage/runtime changes

## Verification target

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct scenario proof from focused hosted/cloudflare and device-sync test coverage

## Notes

- Existing dirty-tree overlap is expected in hosted/runtime and device-sync files; port forward carefully.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
