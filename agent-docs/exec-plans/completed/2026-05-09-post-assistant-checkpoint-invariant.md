# Post-Assistant Checkpoint Invariant

## Goal

Remove the dead `foregroundCheckpointRequired` post-assistant state and make the
hosted runner contract explicit: normal hosted post-assistant effects write local
live-state only, request no foreground checkpoint, call no checkpoint path, and
are deferred to idle shutdown.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- Focused assistant-runtime tests for hosted workspace runner behavior

## Constraints

- Preserve existing outbox/provider cleanup behavior.
- Do not change checkpoint reason enums or hosted side-effect contracts outside
  the dead foreground-required field.
- Preserve unrelated dirty work in the checkout.

## Verification

- Run focused assistant-runtime tests for the touched checkpoint behavior.
- Run `pnpm typecheck`.
- Run the required scoped/diff verification unless blocked by unrelated dirty
  work.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
