# Failed foreground start re-admits in the same command

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- A foreground runtime start that fails at native readiness, before anything
  launched, recovers in the command that owns it. The member waits for one
  extra start, not for the 30-second startup deadline.

## Evidence

A cold typing-latency alert measured about 35 seconds from an inbound message
to the typing indicator. The runtime took about 4 seconds once it started.
The rest was scheduling:

1. The message arrived a few minutes after a Cloudflare runtime deploy.
   The direct start claimed ownership and was handed a ready standby slot.
2. That slot was prepared during the deploy's same-release image transition,
   when both image pairs are admitted. After promotion only the new pair
   matches, so the slot's warm health check failed on a bundle fingerprint
   mismatch. The slot destroyed its container and cold-started at once, and
   that start rejected because the old sidecar was still shutting down.
3. `container_readiness` rejected after 2.8 seconds and the command threw.
   The owner stayed `starting`.
4. The scheduler's own ensure had arrived while the direct start was in
   flight. It saw the `starting` owner and was told to retry at the 30-second
   startup deadline. Nothing shortened that wait after the start failed.
5. At the deadline the retry retired the dead owner through exact native
   retirement and started a fresh attempt in 1.5 seconds.

Seven days of processing summaries show fresh starts throwing at
`container_readiness` between 1 and 11 times a day. Each one leaves the same
30-second hold.

## Success criteria

- A default-mode start that made its own claim and whose readiness rejects
  (not a deadline) retires its exact target, releases the owner after
  confirmed stop, and re-admits within the same command.
- An unproven stop keeps ownership pinned, as before.
- Readiness deadlines, busy results, failed preparation, failed launch,
  supplied claimed snapshots and every background start behave as before.
- Focused tests cover all of the above.

## Scope

- In scope: `startClaimedRuntime` in `apps/cloudflare/src/runtime-processing.ts`,
  its tests, and the owner doc `agent-docs/references/hosted-postgres-runtime.md`.
- Out of scope: the stale standby slot that triggered this start failure
  (see Follow-up), the slot's immediate cold start after a warm-health
  destroy, typing placement, and the 30-second deadline for uncertain starts.

## Constraints

- Age never proves stoppedness. Replacement stays authorized only by exact
  native retirement proof and release, the same steps the deadline path runs.
- No new state, no new retry reason, no Web change, no RPC shape change.

## Risks and mitigations

1. Risk: foreground priority cancels a background start's readiness on
   purpose. If that start re-admitted itself it could race the foreground
   claim and delay it.
   Mitigation: only default-mode starts recover in place. Nothing preempts a
   foreground claim, so its readiness rejection is its own failure.
2. Risk: retiring a start that is still in flight.
   Mitigation: a deadline (command budget or RPC timeout) keeps the existing
   path. A rejection ended the readiness call, and no invocation was launched
   because launch follows readiness.
3. Risk: a supplied claimed snapshot can reach two commands. One could launch
   while the other's readiness rejects, and retirement would then stop accepted
   work. Found by the pre-landing deep review.
   Mitigation: recover in place only for a claim the command made itself. The
   claim transaction returns `claimed` to exactly one caller. Current Web
   supplies only `existing` snapshots, so this excludes no production start.
4. Risk: repeated failed starts spend start budget and standby slots.
   Mitigation: the existing three-admission bound per command and the Web
   start budget both still apply.

## Tasks

1. Convert a foreground readiness rejection into exact retirement and
   re-admission. Done.
2. Update and add focused tests. Done.
3. Update the owner doc. Done.
4. Final review, CI, merge, then one Cloudflare runtime deploy.

## Decisions

- Recover in the command that holds the claim rather than shorten the
  deadline or wake the scheduler. The command already has the exact owner,
  the retirement steps and remaining budget; the scheduler's later retry then
  finds a live runtime and wakes it.
- Wait for preparation to settle before retiring. It is read-only and bounded
  by the command budget, and a preparation failure keeps today's behavior.
- Leave `cleanup_unsettled` alone. A busy retained target may still be
  settling its previous completion, and retiring it would interrupt that.

## Follow-up (not in this change)

A standby slot proven during a same-release image transition stays `ready`
after promotion, and the first claim after the deploy receives it. With this
change that costs one failed start (about 3 to 4 seconds) instead of 30.
Removing the failed start needs the standby coordinator to re-prove ready
slots when the Worker version changes, before a claim can receive them. That
adds coordinator state and belongs in its own reviewed change.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-processing-postgres.test.ts apps/cloudflare/test/runtime-processing-summary.test.ts apps/cloudflare/test/index.test.ts`:
  273 passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm complexity:diff`: passed, no change in debt.
- After the runtime deploy: processing summaries with
  `runtimeProcessingLastObservedFailedOperation = container_readiness` and
  outcome `runtime_processing_accepted` show recoveries; default-mode `threw`
  rows at that step should stop.
Completed: 2026-11-14
