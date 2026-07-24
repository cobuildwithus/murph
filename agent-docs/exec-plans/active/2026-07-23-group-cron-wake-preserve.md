# Preserve armed assistant wake through pre-checkpoint-safe system-mailbox passes

## Goal

Fix the hosted-runtime wake drop that leaves saved cron automations permanently
dormant in fresh group-thread containers: a `foregroundCausalOnly`
(pre-checkpoint-safe) system-mailbox pass checkpoints a wake computed without
any cron/background candidates, overwriting the previously armed workspace
assistant wake with `null`.

Success criteria:

- A `foregroundCausalOnly` pass can only ever tighten the workspace wake, never
  disarm it. The pre-existing workspace assistant wake stays a candidate in
  both the assistant-phase wake selection and the system-mailbox
  post-checkpoint wake selection.
- No added I/O or latency: the preserved candidate comes from the workspace
  state already held in memory (`createExistingHostedAssistantWorkspaceWakeCandidate`);
  the pre-checkpoint lane still performs zero cron status reads.
- A focused assistant-runtime regression test proves the drop before the fix
  and the preservation after.
- A hosted-local E2E regression in the existing harness proves the end-to-end
  incident shape: save an assistant cron automation, drive the
  pre-checkpoint-safe system-mailbox pass, idle-checkpoint, and assert the
  persisted workspace `nextWakeAt` remains armed (and the automation later
  fires) so CI catches regressions.

## Constraints

- Root cause evidence: prod incident 2026-07-23, group container checkpointed
  `nextWakeAtPresent: false` at 07:23:45Z after a `pre_checkpoint_safe` pass at
  07:20:43-45Z consumed the armed cron catch-up wake
  (`checkpointReason: system_mailbox_receipt`); five active automations never
  scanned. Fix the smallest wake-selection seam, no new state or scheduler.
- Do not touch the foreground reply deferral (`shouldDeferCronAfterHostedReply`)
  or add cron reads to `foregroundCausalOnly` passes.
- No customer identifiers in code, tests, docs, or commits.

## Approach

1. In `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`,
   add the existing-workspace-wake candidate to the `foregroundCausalOnly`
   wake selections (system-mailbox phase result ~line 4422 and
   `runSystemMailboxPostCheckpointPhase` ~line 4695).
2. Focused unit/integration regression in `packages/assistant-runtime` tests.
3. Hosted-local E2E regression in the existing hosted-local harness lane.
4. Scoped verification via `pnpm test:diff` plus the touched E2E lane.

## State

Active.
