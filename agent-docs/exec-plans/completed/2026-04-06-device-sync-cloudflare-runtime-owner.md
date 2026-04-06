# Device Sync Cloudflare Runtime Owner

## Goal

Land the supplied hosted device-sync patch so Cloudflare owns mutable hosted runtime state while Postgres retains only static connection identity/mapping rows, sparse signals, and token-audit history.

## Why

The hosted device-sync control plane should stop dual-writing mutable runtime state into Prisma and treat the Cloudflare runtime store as the single mutable owner for connection runtime, token escrow, and disconnect/apply state.

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/device-sync/**`
- `apps/web/README.md`

## Guardrails

- Preserve unrelated dirty worktree changes.
- Port the supplied patch intent without broadening behavior beyond hosted device-sync runtime ownership.
- Keep Postgres as static identity/mapping plus sparse signal/token-audit storage only.
- Run required verification and the mandatory final audit pass before handoff.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`

## Status

- 2026-04-06: Plan opened for supplied hosted device-sync runtime-owner patch landing.
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
