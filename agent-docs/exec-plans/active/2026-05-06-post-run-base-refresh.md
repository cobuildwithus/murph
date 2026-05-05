# Post-run hosted base snapshot refresh

Status: active
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Preserve fresh hosted Codex native resume state after ordinary reply turns without putting `.codex-hosted` full snapshotting back on the user-visible reply path.
- Add a small, best-effort post-run base refresh that runs while the restored invocation workspace still exists, after reply delivery durability has already been committed.

## Success criteria

- A normal hosted reply still checkpoints `outbox_sending` and `outbox_receipt` before any base refresh is attempted.
- The base refresh reuses the existing workspace checkpoint path with reason `maintenance`; no new snapshot format, storage path, or container lifecycle persistence mechanism is introduced.
- Base refresh failure or CAS conflict is logged as metadata and does not fail the already-completed invocation.
- The first implementation does not add a fake `Promise.race` timeout around non-abortable snapshot work. If a hard time limit is required, the implementation must pass a real abort signal through the snapshot path or skip the feature.
- No refresh runs from `RunnerContainer.onActivityExpired()` or `onStop()`.
- Tests prove the refresh ordering, skip behavior, failure behavior, and that isolated child cleanup still removes the launcher directory.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
  - focused assistant-runtime runner tests
  - Cloudflare runner/container tests only if a tiny transport or timeout knob is needed
  - hosted runtime protocol docs
- Out of scope:
  - Cloudflare `onActivityExpired()` / `onStop()` snapshotting
  - changing hot checkpoint contents
  - adding a second snapshot writer or second base snapshot reason
  - changing `.codex-hosted` inclusion/exclusion rules
  - making base refresh required for assistant correctness

## Constraints

- Technical constraints:
  - Cloudflare container disk is ephemeral; lifecycle hooks are not durable storage.
  - `onStop()` runs after the container process exits, so it cannot snapshot the child workspace.
  - The current runner uses isolated child temp roots and deletes the launcher root after each invocation. Any refresh that needs the run's `.codex-hosted` must happen before `runHostedWorkspaceInvocationIsolatedDetailed()` reaches its `finally` cleanup.
  - `maintenance` already maps to full snapshots in `resolveHostedWorkspaceCheckpointSnapshotMode()`. Reuse that instead of introducing a new reason unless implementation proves an existing invariant needs a clearer name.
  - The checkpoint session already tracks the current expected workspace version. The refresh should use that session so CAS/version behavior stays identical to existing checkpoints.
- Product/process constraints:
  - User-visible reply latency and delivery correctness outrank native Codex resume freshness.
  - Keep the architecture composable: one checkpoint API, one full snapshot policy, one best-effort post-run hook.

## Risks and mitigations

1. Risk: The refresh silently re-enters the hot path.
   Mitigation: run it only after assistant checkpointing, post-delivery cleanup, usage export cleanup, and mailbox post-checkpoint effects have already completed or been best-effort skipped.
2. Risk: A failed refresh marks a successful reply as failed.
   Mitigation: catch checkpoint conflicts and ordinary failures inside the refresh helper; log a bounded runtime event or existing warning and return.
3. Risk: The refresh repeats immediately after a full checkpoint that already updated the base.
   Mitigation: skip if the latest committed checkpoint reason was already `maintenance` or `system_mailbox_receipt`.
4. Risk: The refresh races a new inbound nudge.
   Mitigation: rely on the same workspace-version/CAS checkpoint path. If a newer invocation wins, the refresh sees conflict and exits.
5. Risk: A full refresh after every reply delays the next inbound message if the user keeps texting.
   Mitigation: add a cooldown based on the current base snapshot `updatedAt`, and skip when the base is fresh. Prefer one refresh per cooldown window over one refresh per turn.
6. Risk: Timeout plumbing spreads through unrelated layers.
   Mitigation: do not add timeout plumbing in the first pass unless it is real cancellation. A local `Promise.race` would let the invocation return while the snapshot still mutates files and writes artifacts, which is worse than no timeout.

## Tasks

1. Add a tiny post-run refresh decision helper in `workspace-runner.ts`.
   - Inputs: assistant phase result, latest workspace, latest committed checkpoint reason, whether assistant work progressed, and current base snapshot `updatedAt`.
   - Output: refresh / skip plus a short skip reason for tests/logs.
2. Track the last committed workspace checkpoint reason in `createHostedWorkspaceCheckpointRequestSession()`.
   - Existing session already tracks latest workspace and expected version.
   - Add only the minimum field needed to avoid duplicate full refreshes.
3. Add a narrow cooldown helper.
   - Read the base ref from `latestWorkspace.snapshotRef` with the existing hosted-execution snapshot-ref helpers.
   - If the base ref is absent, allow the refresh; a full `maintenance` checkpoint is how the base gets created.
   - If the base ref is present, skip when its `updatedAt` is newer than the configured cooldown.
   - Keep the default cooldown conservative enough that an active back-and-forth does not full-snapshot after every message.
4. Add `checkpointHostedWorkspacePostRunBaseRefreshBestEffort()`.
   - Build a checkpoint request from the existing session.
   - Use `reason: "maintenance"`.
   - Preserve latest scheduled wake with `hostedWorkspaceScheduledWake(latestWorkspace)`.
   - Use compact redacted status such as `{ hostedPostRunBaseRefresh: true }`.
   - Catch/log failures and do not throw.
5. Call the helper near the end of `runHostedWorkspaceUntilIdleOrBudget()`, after:
   - `checkpointHostedWorkspaceAssistantPhase()`
   - optional `checkpointHostedWorkspacePostAssistantPhase()`
   - `drainHostedWorkspaceUsageExportBestEffort()`
   - `runHostedMailboxPostCheckpointEffectsAndCheckpointBestEffort()`
6. Keep the no-assistant/import-only path unchanged unless later evidence shows it needs base refresh. The current user problem is reply turns losing fresh native resume state, not idle import.
7. Add focused tests in `hosted-runtime-workspace-runner.test.ts`.
   - Reply path records `outbox_sending`, `outbox_receipt`, then best-effort `maintenance`.
   - Maintenance failure does not reject the invocation.
   - No refresh after an assistant phase that already ended on `maintenance`.
   - No refresh when assistant did not progress.
   - No refresh when base `updatedAt` is inside the cooldown window.
8. Keep `runtime-bridge-workspace.test.ts` coverage for `maintenance` as full and `outbox_*` as hot.
9. Update `agent-docs/references/hosted-runtime-protocol.md` with the exact guarantee:
   - container shutdown does not snapshot;
   - fresh Codex-native continuity is attempted after successful reply turns by post-run maintenance;
   - assistant correctness still rests on hot checkpoints.

## Decisions

- Do not use Cloudflare `onActivityExpired()` for snapshotting. In this repo it runs after the isolated invocation child has returned and its temp workspace is about to be gone or already gone.
- Do not use `onStop()` for snapshotting. Cloudflare documents it as after process exit.
- Reuse `maintenance` instead of adding a new checkpoint reason for the first implementation.
- Keep the refresh best-effort. It improves native resume freshness; it is not a correctness boundary.
- Do not add a timeout wrapper unless the snapshot path can actually abort. Use cooldown/skip policy first, then consider real cancellation only if measurements show it is needed.

## Verification

- Commands to run:
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
- Expected outcomes:
  - runner test proves checkpoint order and best-effort failure behavior;
  - runtime bridge test continues proving `maintenance` is full and reply-path reasons are hot;
  - typechecks catch any contract drift.

## Code Stress Test Notes

- `RunnerContainer.onActivityExpired()` currently only calls `stopWarmContainer()`; `onStop()` only logs. These are lifecycle hooks, not checkpoint boundaries.
- `runHostedWorkspaceInvocationIsolatedDetailed()` creates a temp launcher root, launches the child from it, and deletes it in `finally`. Therefore the post-run refresh must happen inside the child/runtime path before control returns to that cleanup.
- `runHostedWorkspaceUntilIdleOrBudget()` already has the right sequencing and state: it owns the checkpoint session, assistant result, post-checkpoint delivery cleanup, usage cleanup, mailbox effects, latest workspace, and expected version.
- `createHostedWorkspaceBridgeCheckpointSnapshot()` already routes `maintenance` to full snapshots. A post-run refresh should not know how full snapshots are built; it should only request the existing `maintenance` checkpoint.
- Hot-state snapshots include assistant session files but not `.codex-hosted`. A later idle maintenance invocation would restore stale `.codex-hosted`; it cannot preserve the fresh native resume state from the just-finished isolated child. That is why the refresh must run before child cleanup.
- Full snapshot work is not currently cancellation-aware. The first pass should be frequency-bounded by cooldown and correctness-bounded by CAS, not pretend to be time-bounded.
