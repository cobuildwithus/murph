# Hosted Idle Checkpoint Preemption

## Goal

Ensure hosted idle-shutdown checkpoint invocations return scheduled foreground work promptly when liveness reports new input before or during the idle checkpoint path, even if the already-started checkpoint RPC is slow or never resolves.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`

## Constraints

- Keep foreground checkpoint tripwires intact.
- Do not reintroduce broad foreground snapshots or checkpoint request construction.
- Preserve fail-closed behavior before liveness interruption.
- Avoid exposing local identifiers, secrets, raw mailbox payloads, or direct personal identifiers in logs, tests, docs, or output.

## Verification

- Focused hosted runtime workspace-entrypoint tests.
- `pnpm typecheck`
- `pnpm test:diff` scoped to the touched files if feasible.

## State

Completed. Implementation and focused proof are done; scoped commit was blocked by overlapping unrelated dirty edits in the touched assistant-runtime files.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
