# Replies never wait on a workspace snapshot

Status: active
Created: 2026-11-11
Updated: 2026-11-11

## Goal

- Outcome: a fresh Linq reply from the current turn reaches provider entry as
  soon as its turn finishes, even when its delivery boundary carries a parked
  file-approval cycle or a post-acceptance settlement obligation (follow-up
  request, direct nutrition-goal invitation). The workspace snapshot that makes
  those obligations durable starts immediately after dispatch instead of
  gating it.
- Owner rule (2026-11-11): member-visible replies must never wait on durability
  bookkeeping such as workspace publication.
- Reaches: the approval-link reply after `send_vault_file`, follow-up and
  nutrition-invitation replies sent through non-idempotent Linq transports
  (attachments/voice), and any ordinary reply sharing such a boundary.

## Evidence

- An owner-reported 2026-11-11 incident: an approval-link reply was ready at
  turn end but reached provider entry 141 s later
  (`deliverySinceForegroundPhaseStartedMs` on `linq-dispatch-entered`). It was
  marked `publishBeforeDispatch` by the obligation fence from #4658
  (`buildHostedAssistantDeliveryEffects`, `hostedLinqIntentCarriesDurableObligation`)
  and waited for an idle_shutdown snapshot (17 s to build for a ~100 MB
  workspace containing the generated ZIP) that did not start for ~112 s.
- Same flow on 2026-11-09: 39 s from turn end to provider entry.
- Even with an immediate snapshot start, this fence puts snapshot build time
  (12-19 s observed) in front of every approval-link reply.
- A secondary bug (not fixed here) may explain the late snapshot start: on a
  cold-start first pass with restored ready durable effects,
  `prepareInitialForegroundState` awaits `workspaceSystemWork.waitForCompletion`
  without consulting `checkpointStartByMs`. Its existence is proven; that this
  invocation took it is not. Once replies no longer wait on publication, it only
  delays snapshots. Track it as a follow-up.

## Design

Mostly deletion in `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
`buildHostedAssistantDeliveryEffects`:

1. Delete the Linq obligation fence: remove `obligationBoundaryKeys` and the
   loop that adds non-idempotent settlement boundaries to it. A Linq boundary
   that carries a parked approval cycle (`hostedLinqIntentCarriesDurableObligation`)
   or a settlement obligation becomes a `publishAfterDispatch` boundary. The
   existing path in `drainHostedPostCheckpointDelivery` appends a no-op durable
   effect with `checkpointStartByMs: Date.now()`, so publication is requested
   immediately after provider entry.
2. Keep `publishBeforeDispatch` only for duplicate prevention on sends whose
   earlier attempt may already have reached the provider or that were restored
   from a snapshot. That is `hostedAssistantIntentRetryNeedsPublishedClaim`:
   non-idempotent retryable, previously attempted, or created before the last
   checkpoint. Keep the Telegram vault-file clause unchanged: Telegram has
   near-zero traffic, and approved files are already restored sends under rule 2.
   These are recovery paths, not fresh replies.
3. Update the durable owners: the RELIABILITY.md paragraph and the
   00-invariants.md sentence added by #4658 that describe the Linq fence.

## Accepted risk (explicit owner trade-off)

Linq acceptance consumes the answered mailbox items
(`linq-delivery-store.ts`, `answeredMailboxItemIds`). A hard crash after Linq
accepts the reply but before the immediately requested snapshot completes
(~15-25 s window) loses that turn's runtime-only obligations, and the input will
not replay:

- Approval: the member holds an approval link with no parked file. Approving
  does nothing; the member must ask again.
- Follow-up / nutrition invitation: the promised settlement state is lost.

A completed graceful-shutdown checkpoint (SIGTERM) closes this window on
normal deploys; a failed or timed-out shutdown publication does not. Ordinary replies already accept the same window for their
other runtime-only turn state. The owner prefers this over member-visible
latency.

Alternative considered: send immediately, withhold `answeredMailboxItemIds`
for obligation boundaries, and let the snapshot's handled-frontier consume the
input. A crash then replays the turn: duplicate reply, but the obligation is
recreated. Rejected for now: it adds a conditional consumption path and trades
a silent loss for a duplicate member-visible message. Revisit if ReviewGPT
shows the loss window is materially larger than estimated.

## Success criteria

- A current-turn approval-link reply and a non-idempotent settlement reply are
  dispatched inline (provider counter increments before any durable hook runs),
  and the phase result carries an immediate publication deadline
  (`checkpointStartByMs <= now`).
- After that publication, a restored snapshot still holds the parked approval
  intent, its adopted bytes, and the follow-up/nutrition state.
- Retry/restored non-idempotent sends and Telegram vault files still dispatch
  only after their published claim (unchanged tests stay green).
- Engine and runtime typecheck pass. Complexity diff passes. Focused runtime
  publication, settlement, and checkpoint-wake suites pass.

## Scope

- In scope: effect selection in `callbacks.ts`, the affected focused tests, and
  the two owner-doc paragraphs.
- Out of scope: the cold-start `waitForCompletion` deadline bug (follow-up),
  consumption semantics, Web/Worker changes, persisted formats, the retry and
  Telegram fences, and prompts.

## Tasks

1. Red proof: invert the approval-cycle and non-idempotent settlement
   expectations in `hosted-runtime-delivery-publication.test.ts` (inline
   dispatch, then immediate publication, then a restore that still holds the
   obligation). Run against current code and confirm the failure.
2. Implement the selection change (deletion first).
3. Update RELIABILITY.md and 00-invariants.md.
4. Run focused suites, both typechecks, complexity diff, and `git diff --check`.
5. Run the PR-lane ReviewGPT round (core delivery behavior), CI, and merge.
   Then deploy the runner and confirm `deliverySinceForegroundPhaseStartedMs`
   stays under ~2 s on the next approval-link reply.

## Decisions

- ReviewGPT plan review (apollo lane, 2026-11-11; vonneumann lane unavailable,
  its profile was held open by another browser). Verdict: the deletion-first
  design is sound, with no new ledger, consumption change or owner move. It
  confirmed claimedBoundaryKeys, prepared-claim tokens, adopted-byte retention,
  receipt repair, group email and approval route authority are unaffected.
  - P1 publication deadline is not enforced on the cold-start restored-effects
    wait, so the loss window can exceed snapshot build time. Accepted as a
    statement-of-risk correction; the scheduling fix stays a separate follow-up
    (ReviewGPT's option 2). It shortens no reply, touches cold-start
    quiescence, and is not proven to be this incident's cause. The RELIABILITY
    paragraph now says the window runs to successful publication, including
    scheduling waits.
  - P1 accepted-risk statement omitted the duplicate (pre-acceptance) and
    sibling-bubble loss (post-acceptance) cases. Accepted: RELIABILITY lists
    the crash-point matrix. Added a fresh voice-obligation test: inline
    dispatch, a kill at provider entry, no consumption and no settlement. It
    failed on base. Rejected adding a test that restores a pre-turn snapshot to
    "prove" loss: that only exercises the fixture's copy, not runtime code. The
    existing yielded-successor test already proves the publication request
    survives.
  - Implementation shape (one union set, retry and Telegram fences kept,
    settlement-promotion scan deleted): already matches the change.
  - Approval test expectation (restore shows the link reply as sent, no
    predecessor replay): already done.
  - Shutdown wording qualified above.
  - Deploy evidence: also measure acceptance to successful publication, not
    only turn end to provider entry.

## Verification

- Red: on the base selector, the two approval-link cases, the text/voice
  obligation-boundary cases and the fresh voice case failed (sends 0 before
  publication; publishBeforeDispatch selected).
- Green, focused runtime suites on this head: 12 files, 924 tests, exit 0
  (publication, settlement integration, Telegram file checkpoint, callbacks,
  Linq outbox regression, assistant-phase delivery/foreground/outbox
  starvation, system mailbox notification, entrypoint checkpoint wakes/races,
  idle retirement).
- `pnpm --dir packages/assistant-runtime typecheck`, `pnpm complexity:diff`,
  `git diff --check`: exit 0. assistant-engine is unchanged.
