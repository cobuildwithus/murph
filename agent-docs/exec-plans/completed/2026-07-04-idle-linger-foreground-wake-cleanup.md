# PR 380 Idle Checkpoint Foreground Wake Cleanup

## Goal

Address ReviewGPT round 14 findings for PR 380 without adding new lifecycle state:

- Keep foreground-pending mailbox input authoritative over forced pre-wake checkpoints.
- Preserve the invocation-local follow-up wake through a foreground-pending interruption and retry its checkpoint afterward.
- Signal the runtime owner after successful checkpoints that leave either future or due workspace wakes.
- Delete the temporary checkpoint foreground-bypass flag and its forwarding surfaces.

## Constraints

- Preserve `idle_shutdown` as the only hosted idle snapshot reason.
- Do not add a scheduler, queue, persisted wake owner, or runtime alarm fallback.
- Keep web as the durable workspace owner and runtime projection state invocation-local.
- Maintain foreground reply priority and workspace-version CAS ordering.

## Files

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/{workspace-runner,snapshot-bridge}.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/hosted-execution/src/{runtime-control,parsers/runtime-control}.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/test/{hosted-runtime-internal-routes,hosted-workspace-store}.test.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `agent-docs/index.md`
- `agent-docs/references/hosted-runtime-protocol.md`

## Verification

- Focused hosted-runtime wake/checkpoint tests.
- Focused web checkpoint route/store tests.
- Focused hosted-execution parser tests.
- Focused Cloudflare runtime bridge tests.
- `pnpm docs:drift`
- `pnpm typecheck`
- Diff-aware workspace verifier for the touched package/app/doc scope.
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
