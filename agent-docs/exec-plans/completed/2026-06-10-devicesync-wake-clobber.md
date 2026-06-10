Goal (incl. success criteria):
- Stop device-sync-only hosted wakes from narrowing/clobbering an armed assistant cron wake in the persisted workspace `next_wake_at`.
- Success: a prod-faithful regression test seeds a real active `at` automation, processes a `run-device-sync-wake` system-mailbox item through `runHostedWorkspaceAssistantPhase`, and the phase (and post-checkpoint) `nextWakeAt` still covers the earlier cron occurrence. Test fails on current code with the prod signature (device-sync-only wake replaces the cron wake).

Constraints/Assumptions:
- Fix stays inside `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`; no Temporal workflow or web checkpoint-store changes.
- Cron wake candidate read is best-effort: a failed vault read must not break the device-sync lane.
- Reuse the existing precedent: `drainHostedPostCheckpointDelivery` already merges `getAssistantCronStatus().nextRunAt` as a candidate.

Key decisions:
- Root cause (proven from prod `hosted_runtime_log` + code path): system-mailbox-only invocations early-return a result whose wake candidates exclude assistant cron (`runSystemMailboxMaintenancePhase` candidate list), and `checkpointHostedWorkspace` blind-overwrites `next_wake_at`. Prod misses: 2026-06-10 02:45 reminder (woken by user text 02:51), 2026-06-10 02:00 (other user, 32 min late), 2026-06-08 15:00 (179 min late).
- Fix at the candidate-list layer (preserve-by-recompute), not min() in the DB writer, so `next_wake_at = null` semantics stay intact.

State:
- Done; ready for PR.

Done:
- Root cause proven from prod runtime logs and code-path evidence.
- Regression test failed pre-fix with the prod signature (device 08:03 replaced armed cron 02:45); fix landed at all system-mailbox/device-sync-only candidate selections.
- Coverage pass added idle-path, earliest-wins, and cron-read-failure tests (94/94 phase file; 60 files / 810+ package suite; typecheck clean).
- task-finish-review: safe to land, findings low/advisory only.
- Live prod check: un-clobbered 03:45:00Z timer fired at 03:45:08 (no device-sync wake in window).

Now:
- Open PR.

Next:
- Post-deploy: verify in `hosted_runtime_log` that an armed cron wake survives an intervening device-sync wake.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
