# Hosted Runtime Provider Cleanup Wake

## Goal

Fix the production hosted-runtime latency regression where deferred provider-cleanup
wakes can be emitted at the assistant phase-start time, collapsing the dirty
idle-checkpoint window and causing premature `idle_shutdown` snapshots after
foreground Linq replies.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/provider-cleanup.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- Focused hosted-runtime tests under `packages/assistant-runtime/test/`

## Constraints

- Keep `wake-candidates.ts` a dumb earliest-valid-timestamp selector.
- Do not add a scheduler, queue, manager, config knob, or broader wake priority
  model.
- Provider cleanup owns its own first defer/retry wake timing.
- Foreground conversation input remains higher priority than device sync,
  provider cleanup, maintenance, and idle checkpointing.

## Verification

- Update existing provider-cleanup wake tests.
- Add a foreground-entrypoint regression proving idle checkpointing does not
  start before the configured dirty idle window when cleanup is deferred.
- Run the targeted assistant-runtime verification lane.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
