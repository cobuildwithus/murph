# Cold start skips the vault-share offer while publication is due

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal

- Outcome: on a cold start that restored ready durable-checkpoint effects
  (typically a device-sync "recording" journal), a due workspace publication
  starts promptly after the foreground pass. It no longer waits behind the
  optional vault-share projection or the system-work completion wait.
- Follows #4840 (replies no longer wait on publication). A due publication
  still gates retry/restored-send claims (`publishBeforeDispatch`), consented
  Ask gate releases and owner handoff. For approval-link, follow-up and
  nutrition replies it also bounds the accepted crash-loss window.

## Evidence

Production runtime logs (`hosted_runtime_log`), owner subject, both delayed
approval links:

- 2026-11-11: a `fresh_start` cold start at 16:23:47. The link turn's pass
  finished at 16:24:46; the `outbox_sending` deferral then waited for a due
  publication, and the post-assistant commit finished at 16:24:57. Then nothing
  was logged for 66 s, and no device-sync pass ran. At 16:26:03 the next message
  ran its turn (post-assistant commit 16:26:19.326). `device-sync.checkpoint_recorded`
  (the restored recording's after-checkpoint effect) followed 167 ms later.
  A third turn ran, and the snapshot (17.3 s, 100.7 MB, 38 MB generated ZIP)
  finished at 16:27:06.76. The link dispatched 141 s after its turn ended.
- 2026-11-09: a cold start at 01:41:40, then a first turn. The link turn ran
  from the next message. `device-sync.checkpoint_recorded` followed its commit
  by 151 ms. The snapshot started ~14 s later (19 s build). Total 39 s.
- These were the only Linq dispatches over 20 s in 10 days apart from one
  unrelated case (74 s inside a delivery phase with no checkpoint, 11-05,
  another member; out of scope).

Code path (`packages/assistant-runtime/src/hosted-runtime.ts`,
`prepareInitialForegroundState`, ~7024-7060):

```ts
const restoredEffectsPending = readyDurableCheckpointEffects.length > 0;
const drainRestoredEffects = !runtimeStateDirty || restoredEffectsPending;
if (drainRestoredEffects) {
  const vaultShareOpportunity = await offerHostedVaultShareProjectionDuringIdle();
  ... if (vaultShareOfferWake) await runForegroundPass(...);
  await drainCleanDurableCheckpointEffects({ vaultShareProjectionResult, withhold... });
  if (restoredEffectsPending) {
    workspaceSystemWork.kick();
    await workspaceSystemWork.waitForCompletion(wakeSignal, runPreCheckpointConversationWake);
  }
}
```

- `offerHostedVaultShareProjectionDuringIdle` starts `projectHostedVaultShareCheckpoint`.
  That restores the committed snapshot into scratch space, captures it in a
  worker and offers it. It waits for the projection or an external wake and
  ignores `idleCheckpointStartByMs`. Its success outcome is not logged.
- The steady-state loop already refuses this offer while publication is due
  (`mayOfferVaultShareProjection` checks `hostedDurableEffectsCheckpointIsDue`),
  and offers it only on a clean runtime after the checkpoint. The cold-start
  branch runs it even when the runtime is dirty and the deadline has passed.
- After a wake preempts the offer, the existing code drains the restored effects
  with `outcome: "preempted"` and withholds vault-share-dependent effects. Both
  incidents took this path; the recording ack fired 151-167 ms after the
  preempting turn. Then `kick()` plus `waitForCompletion` (no deadline) waits
  for every tracked local mutation before the checkpoint loop.
- The first-turn wait is plausibly the projection. It is the only unbounded
  await in that window, and no other logged work occurred. Because projection
  success is not logged, this is strongly supported by the trace and code, not
  observed directly. The 11-09 gap after the drain is consistent with the
  system-work wait.

## Design

Treat "a dirty publication is due" exactly like an already-preempted vault-share
offer. Change only `prepareInitialForegroundState`:

1. Add a local predicate
   `const dirtyPublicationDue = () => runtimeStateDirty && idleCheckpointStartByMs !== null && idleCheckpointStartByMs <= Date.now()`.
   `updateIdleCheckpointTimerAfterWorkspacePass` already folds every outstanding
   effect deadline (`checkpointStartByMs`), Ask gate release and owner handoff
   into `idleCheckpointStartByMs`. No new state.
2. When it is true, skip `offerHostedVaultShareProjectionDuringIdle()` and use
   `{ result: { outcome: "preempted" }, wake: null }`. The existing incomplete-
   projection handling then withholds vault-share-dependent effects, exactly as
   after a wake preemption.
3. Keep `drainCleanDurableCheckpointEffects` (fast; the device-sync ack). Its
   follow-up still joins the imminent checkpoint, so no extra snapshot.
4. (Dropped after ReviewGPT.) The restored system-work `kick()`/`waitForCompletion`
   stays unchanged, because it coalesces newly admissible device work into the
   same save.
5. No change to the steady-state loop, `workspace-system-work.ts`,
   persisted formats or Web/Worker.

Cost: no added snapshot when the restored drain's follow-up joins the first
checkpoint. Device-sync work that only became admissible after the recording
ack, and that the old wait would have folded into the first save, now runs
after it and may dirty the runtime for one more idle save before release. This
happens only when a cold start restored a recording, a publication was due, and
device-sync work was waiting behind the recording owner. Such work stays durable
in the system mailbox and may wait for a later invocation. The skipped
vault-share projection is not guaranteed in this invocation: after publication
the already-due effects block the offer (`mayOfferVaultShareProjection`), and a
due no-op requests no follow-up. Projection-dependent records under an explicit
`preempted` result persist retries, exactly as after a wake preemption today, so
the projection runs on a later clean opportunity (Codex c2 verification,
`workspace-assistant-phase.ts:3859-3889`, `system-mailbox.ts:1164`, `1774-1780`).

Rejected: deadline-aware cancellation inside the projection or
`waitForCompletion` adds owners and cancellation paths. Skipping the whole
restored branch adds a second snapshot when the recording ack needs a follow-up
(owner rule: no cold-start cost increase). Cancelling an already-running
preempted projection is a separate concern.

## Success criteria

- Red, then green, integration proof: a cold start with a restored recording,
  a foreground turn whose result makes publication due, and a vault-share
  projection that never resolves without cancellation. The snapshot starts
  without waiting on the projection, the recording ack still runs once, and no
  second snapshot is taken for the ack.
- The 11-09 shape (the due reply comes from the wake that preempts the offer,
  then the retained system-work wait) is out of scope after ReviewGPT P1.
- Not due (ordinary dirty turn, idle window open): the offer and the system-work
  wait still run as before.
- Focused entrypoint/system-recording/vault-share/device-sync suites,
  typecheck and complexity diff pass.

## Scope

- In: `prepareInitialForegroundState`, focused tests, and a RELIABILITY line on
  the cold-start ordering.
- Out: projection success logging; projection cancellation; the 11-05
  delivery-phase delay; the steady-state loop.

## Tasks

1. ReviewGPT plan review; record dispositions.
2. Red tests (Codex c2) in `hosted-runtime-interrupted-system-recording.integration.test.ts`
   or the entrypoint checkpoint-wakes suite.
3. Implement; green; focused suites; typecheck; complexity diff.
4. PR, ReviewGPT PR round, CI, merge. Verify the next cold-start approval link in
   production.

## Decisions

- Codex c2 read-only verification (2026-11-11). Claims 1-4 were verified with
  line evidence: the cold-start offer runs with no deadline check; every returned
  due effect, Ask gate and owner handoff feeds `idleCheckpointStartByMs`
  (shutdown publication has its own path); the restored recording effect is not
  withheld under `preempted`, and its follow-up joins the next snapshot; the
  checkpoint boundary quiesces system work and settles owned mutations. Claim 5
  was an overclaim: the projection and withheld dependent work are durable but
  may wait for a later invocation. The wording above is corrected.
- ReviewGPT plan review (apollo, 2026-11-11), verdict "revise step 4":
  - P1, accepted: the post-replay system-work `kick()`/`waitForCompletion` is the
    admission point that folds device work B (blocked behind restored recording
    A) into the same save as A's cleanup (ARCHITECTURE.md: replay cleanup and the
    next bounded pass share one idle save; publication leaves system work
    paused). Skipping it when due can move B to a successor invocation with its
    own snapshot, which violates the owner's no-cold-start-cost-increase rule.
    No existing composition gives both prompt publication and A+B coalescing.
    Decision: drop design step 4 and keep the restored system-work wait
    unchanged. Residual: that wait can still delay publication (consistent with
    ~14 s on 11-09). Replies no longer wait on publication (#4840), so this only
    affects durability timing.
  - Decision point: evaluate the predicate once, before the offer and before the
    restored drain, so replay cleanup (which stages a follow-up and arms an
    immediate timer) cannot manufacture a due publication. Accepted.
  - No vault-share port: keep the helper's `no-port` result. Synthesize
    `preempted` only when a port exists. Accepted.
  - Wording: under `preempted`, `requiresVaultShareProjectionResult` effects
    still run and the projection-obligation recorder retains its retry. The
    invariant is "no false completion", not "withheld". The restored ack is not
    constant time (151-167 ms observed). The 66 s attribution stays "strongly
    supported", not proven per stage. Accepted.
  - Deadline crossing after entry: the projection can only end through
    completion or a preempting wake, so a not-due entry cannot become due
    mid-offer without a wake. Documented as a limitation, not widened.
  - Correction accepted: `waitForCompletion` already takes `deadlineMs`. The
    rejected-design note is reworded.
  - Tests: due-before-offer with a hanging projection (snapshot starts, the
    projection never started, the recording replays once and its cleanup is in
    the first capture); a not-due control (offer still runs before the
    checkpoint); the existing clean-start, no-port and deadline suites stay green.
    The A+B whole-convergence proof is moot because admission is unchanged.
- Predicate narrowed during implementation, diverging from the plan's timer
  predicate. `runtimeStateDirty && idleCheckpointStartByMs <= now` also fires
  for owner handoff and other immediate checkpoints. Two system-mailbox
  entrypoint tests ("preserves successful dirty-ack follow-up wake", with
  assistant work already due or a ready default-owned wake) failed with it.
  They encode the RELIABILITY contract that a successful checkpoint gets one
  vault-share projection opportunity before the device-sync dirty ack. Final
  predicate: `hostedDurableEffectsCheckpointIsDue(pendingDurableCheckpointEffects)`.
  That is the same effect-deadline signal the steady-state
  `mayOfferVaultShareProjection` uses, and the incident's actual cause (a due
  outbox/publication effect). Ask gate releases and owner handoff keep the
  projection. RELIABILITY.md now states the new preemption reason.
- The decision lives in a small helper (`offerVaultShareProjectionUnlessPublicationDue`)
  so `prepareInitialForegroundState` gains no complexity (the guard flagged
  20 -> 24 when it was inline).

- PR #4846 ReviewGPT round 1 (apollo) on c3cc0d208e: PASS with no findings,
  but not attested (completed at 246 s without response-model metadata, the
  same pattern as #4840). Not retried. A fresh read-only Codex c2 review of the
  same head found no qualifying findings: the queue is correct, the synthetic
  preemption is replay-safe, and the test is non-vacuous. It noted that
  repeated due cold starts can keep postponing the best-effort projection
  while obligations keep their retries. Required CI was green after one rerun of
  an unrelated web game PostgreSQL perf test. Owner decision 2026-11-11:
  merge once CI is green.

## Verification

- Red: on the base source, the due case failed with "Due publication did not
  start snapshot capture: projection starts=1, acknowledgments=0" (the incident
  shape). The not-due control passed.
- Green on this head: 29 assistant-runtime files (every
  hosted-runtime-workspace-entrypoint* suite, interrupted-system-recording,
  projection-wake-convergence, checkpoint-progress, vault-share-background,
  idle-retirement, browser-vault-refresh-mailbox, concurrent-device-import,
  hosted-device-sync-runtime, mailbox-checkpoint, empty-followup,
  delivery-publication): 836 tests, exit 0.
- `pnpm --dir packages/assistant-runtime typecheck`, `pnpm complexity:diff`
  (hosted-runtime.ts debt 411 -> 411) and `git diff --check`: exit 0.
- Implementation and tests were delegated to Codex c2 (workspace-write),
  then reviewed, narrowed and re-verified by the parent.
Completed: 2026-11-11
