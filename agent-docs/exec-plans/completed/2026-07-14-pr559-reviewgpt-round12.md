# PR 559 ReviewGPT Round 12

## Goal

Resolve the corrected-head ReviewGPT verdict before merging PR 559:

1. Preserve the web-owned `DISCONNECT_IN_PROGRESS` authority token against every hosted-runtime connection writer.
2. Keep an accepted companion import on one delayed local job through plain canonical-owner failures until canonical success, including after its ordinary attempt fence.

## Constraints

- Keep disconnect authority in the web control plane under the existing connection mutation lock.
- Keep encrypted web payloads as reconstruction authority and the local device-sync scheduler as the only retry-timing owner.
- Do not add a queue, retry table, lifecycle owner, or compatibility layer.
- Preserve canonical-success-only companion acknowledgement and credential-free completion after disconnect.

## Working Set

- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- `apps/web/test/device-sync-hosted-runtime-authority.test.ts`
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/store.ts`
- `packages/device-syncd/src/store/jobs.ts`
- `packages/device-syncd/test/service.test.ts`
- Matching device-sync invariant and hosted-control-plane docs.

## Verification Plan

- Add a local-state-only hosted-runtime callback regression at an exact disconnect-sentinel snapshot revision.
- Run the focused hosted-runtime authority test file and web typecheck.
- Run the device-sync service regression proving a disconnected accepted companion import retains one delayed job through repeated plain canonical errors and eventual success beyond its ordinary attempt fence.
- Run required diff verification and completion audits.
- Push with an exact-head guard, then run ReviewGPT concurrently with CI until there are zero accepted findings.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
