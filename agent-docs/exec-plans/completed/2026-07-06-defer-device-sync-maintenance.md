# Defer Hosted Device-Sync Maintenance

## Goal

Move hosted device-sync maintenance out of the runner static boot closure while
preserving existing lane behavior. The runner entry chunk should only load the
device-sync service/registry/provider graph when a device-sync lane actually
runs.

## Constraints

- Keep assistant automation maintenance eagerly available in
  `maintenance.ts`.
- Move device-sync lane logic with minimal behavioral edits.
- Use a cached dynamic import that resets on rejection and exposes a typed load
  error.
- Keep foreground reply priority and existing fail-closed device-sync behavior.
- Do not commit or push from this worktree.

## Current State

- Fresh `pnpm install` completed.
- Required routing, architecture, verification, security, reliability, hosted
  runtime, Cloudflare, assistant-runtime, and device-sync docs were read.
- Implemented and verified locally. No commit or push performed.
- Production callers identified: `events.ts` uses the lazy loader for explicit
  `device-sync.wake`; `workspace-assistant-phase.ts` uses it for idle
  maintenance and next-wake projection. No boot/checkpoint module-evaluation
  caller was found for `resolveHostedDeviceSyncNextWakeAt`.

## Implementation Notes

- New lazy module owns `runHostedDeviceSyncPass`,
  `runHostedDeviceSyncWakeLane`, `resolveHostedDeviceSyncNextWakeAt`, and their
  private helpers.
- Callers import loader helpers instead of the heavy module.
- Existing lane tests import the new device-sync module directly.
- Bundle guard adds device-sync/importers/Junction forbidden boot markers
  while allowing dynamic chunks.
- Final measured real runner bundle: entry `1,267,937B`, static closure
  `6,809,980B`, total `8,223,286B`.

## Verification Plan

- `pnpm --dir apps/cloudflare runner:bundle` passed.
- Runner bundle entrypoint Vitest file through the repo-root app config passed.
- Focused assistant-runtime maintenance/device-sync/events tests plus loader
  coverage passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.

Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
