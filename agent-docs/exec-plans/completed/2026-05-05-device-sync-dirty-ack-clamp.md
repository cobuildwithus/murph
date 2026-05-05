# Device Sync Dirty Ack Clamp

## Goal

Clamp hosted device-sync dirty-state acknowledgements so an internal runtime ack cannot advance `processed_revision` beyond the current `dirty_revision`.

## Context

The deployed greenfield device-sync architecture now treats provider webhook freshness as trace/audit plus dirty state plus best-effort runner nudges. The runtime acks dirty revisions after checkpoint-safe local handoff. A malformed or buggy internal ack must not make future dirty work invisible by storing `processed_revision > dirty_revision`.

## Scope

- Patch `PrismaHostedDirtyConnectionStore.markDirtyConnectionProcessed`.
- Add a focused regression test for over-ack clamping.
- Verify with focused web tests and typecheck.

## Non-Goals

- Do not change the broader dirty-state runtime protocol.
- Do not alter currently dirty/unrelated hosted wake-service edits.
- Do not add partial indexes or observability-only cleanups in this patch.

## Verification

- Focused dirty-connection store test.
- Relevant hosted device-sync test coverage if touched.
- Web typecheck.

## Result

- `markDirtyConnectionProcessed` now clamps requested processed revisions to the current dirty revision.
- Added a focused regression test for malformed over-ack input.
- Verified with:
  - `pnpm --dir apps/web test prisma-store-dirty-connections.test.ts`
  - `pnpm --dir apps/web typecheck:prepared`
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
