# Runner Alarm Cleanup

Status: completed
Updated: 2026-07-08

## Why

ReviewGPT's Mountain pass agreed that the stale write-fence replacement path
should keep its current correctness proof. The small cleanup worth landing now
is to delete runner alarm coordination from the runtime processing hot path:
today the generic runner alarm coordinator only points at workspace snapshot
orphan cleanup, so reply wake/start paths pay for an unrelated storage scan and
carry ownership they should not know about.

## Scope

- Remove `RunnerAlarmCoordinator` from runtime processing and invocation
  services.
- Keep stale write-fence replacement semantics unchanged.
- Make workspace snapshot sessions remain the sole owner of orphan-candidate
  alarm scheduling and cleanup.
- Avoid new state, queues, managers, config, or fallback owners.

## Deletion Ledger

- Delete the generic runtime alarm coordinator abstraction.
- Delete runtime hot-path calls that resync snapshot orphan cleanup alarms.
- Delete the always-null runner alarm projection helper.

## Verification

- Focused Cloudflare user-runner alarm tests covering orphan cleanup and runtime
  wake paths.
- Cloudflare typecheck.
- Diff hygiene checks before commit.
Completed: 2026-07-08
