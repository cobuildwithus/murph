# Mailbox Wake Latency + Complexity Collapse

Status: active
Updated: 2026-07-03

## Why

Prod traces (2026-07-03) put the hot warm-container reply at ~4.5s webhook →
provider start. PRs #370/#371 instrumented and collapsed the webhook plan
transaction (~0.4–0.5s). The remaining avoidable cost is wake dispatch
(~0.8s of Temporal Cloud + Render → Cloudflare transport for a stateless
poke) and duplicated gating on the import path. The direct wake was built
and withdrawn in PR #362 because "answered" only becomes durable at
checkpoint, so racing ensures could re-answer input (reachable duplicate
reply, June incident class).

Root principle of this plan: the mailbox row in Postgres is the durable
truth; a wake is an idempotent notification. Temporal remains the only
owner of orchestration state (retries, schedules, reconciliation). Making
"answered" durable at reply delivery removes the only correctness coupling
between wake latency and orchestration, after which the fast path and the
backstop compose instead of racing.

Organizing constraint: the series must land net-negative in code,
concepts, and branches. Each PR carries a deletion ledger.

## PR sequence (two PRs)

### PR 1 — consume authority at delivery + Linq direct wake

One PR, two commits-worth of shape: the consume-authority foundation and
the direct wake it makes safe. They deploy as one unit; the deploy-window
analysis below replaces the earlier staged four-PR gate.

#### Part 1a — delivery-report-as-consume-authority (net deletion)

The runtime already reports every Linq delivery outcome to
`POST /api/internal/hosted-runtime/linq-egress/delivery`
(`apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts`),
with `acceptedAt`/`failedAt`, intent id, idempotency key. Sent and consumed
become one fact on one callback:

1. Stamp answered-conversation coverage (lane → highest contiguous
   terminally-handled seq) on the outbox reply intent at creation, where
   the turn already knows its answered inputs' `laneSeq`
   (`AssistantInputSourceRef`).
2. Forward the stamp on the existing delivery report.
3. The delivery route advances `consumed_seq` via the existing
   `advanceHostedMailboxConsumedSeqByLane` (monotonic-max, clamped) in the
   same transaction that records the outcome — on `acceptedAt` only.
4. Net the watermark into the lag the orchestrator reads:
   `computeHostedMailboxLaneLag` (`apps/web/src/lib/hosted-mailbox/lag.ts:7-27`)
   becomes `lag = maxSeq − max(importedSeq, consumedSeq)`. Today
   `importedSeq` publishes only at checkpoint and `consumedSeqByLane` in the
   reconciliation facts feeds only usage-gate freshness — the workflow's
   `hasAnyMailboxLag` never sees delivery-time handling. This one change is
   what makes the Temporal backstop stand down when the direct wake has
   already handled a message, and it is semantically true: consumed input
   needs no wake. It removes the need for any workflow-side coordination,
   delay timer, new patch marker, or replay fixture (see Part 2a — the recheck-only redesign this
   finding collapsed).
   Implementation care: `computeHostedMailboxLaneLag` gains an optional
   `consumedSeq` input rather than netting implicitly, and BOTH callers
   are updated deliberately: the reconciliation-facts route (netted — the
   workflow backstop must stand down at delivery) and
   `/api/internal/hosted-runtime/status` (`status/route.ts:35`, consumed
   by runner status + transport-failure recovery in
   `runtime-invocation.ts:471` / `hosted-user-runner.ts:157`) which must
   either also net (fetch consumedSeq there too) or be explicitly
   documented imported-only after auditing its Cloudflare consumers.
   Decide during implementation with those consumers read first; do not
   leave the two surfaces silently divergent. The usage-gate freshness
   path already reads `consumedSeqByLane` separately and must not
   double-net. A crashed-after-delivery container
   is the key scenario: `consumedSeq` (durable at delivery) > `importedSeq`
   (stale checkpoint) is the normal state, and the next invocation
   re-serves the consumed prefix as context-only - no wake owed, no reply
   lost.

Deletion ledger:
- `stageHostedConversationMailboxConsumedAckBestEffort` + 4 skip gates +
  `consume_ack_skipped` logging + coverage resolver
  (`packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
  ~1269–1490, ~220 lines; fires ~8k skip logs/week, ~0 acks).
- `/api/internal/hosted-mailbox/consume` route + `HostedMailboxPort.consume`
  optional method + guarded deploy-window wiring
  (`apps/cloudflare/src/runtime-platform/mailbox-port.ts:26-43`,
  `packages/assistant-runtime/src/hosted-runtime.ts:3458-3461`) — the
  optionality that caused the June `consume_port_missing` incident.
- `isHostedMailboxLaneCheckpointed` (`apps/web/src/lib/hosted-mailbox/lag.ts:29-42`)
  - dead export, zero callers repo-wide.
- Added: one intent field, one forwarded body field, one store call in an
  existing route transaction.

Verified against source (2026-07-03):
- `computeHostedMailboxLaneLag` has exactly one production caller
  (`runtime-reconciliation-facts.ts:127`), and `consumedSeqByLane` is
  already fetched in the same Promise.all (`:115-122`) - the netting is a
  one-seam change with no other lag consumers to audit.
- `recordHostedLinqRuntimeDeliveryOutcomeTx` runs inside
  `runHostedLinqDeliveryStoreTransaction` (`linq-delivery-store.ts:494`),
  so the watermark advance joins an existing transaction atomically. It
  early-exits `recorded: false` without an idempotency key; coverage
  therefore rides only outbox-managed replies (which always mint a key) -
  reaction/keyless sends never advance the watermark, which is correct
  (a reaction is not reply coverage).

Design constraints (pinned by docs/contracts/00-invariants.md §42–45 and
hosted-runtime-protocol.md §519–526):
- Coverage = contiguous prefix of conversation-lane inputs with terminal
  evidence. The lane interleaves channels; coverage must never exceed a
  pending input from another channel (a Linq reply covering seq 7 must not
  ack a pending Telegram seq 6 — that would durably orphan it).
- Never advance on `failedAt`; retryable-not-terminal semantics unchanged.
- No-reply turns (`finish_without_reply`) intentionally get no ack: a
  re-run re-suppresses (compute waste, never a user-visible duplicate).
  Add coverage only if churn data ever proves the cost (measured-bottleneck
  rule).
- VERIFIED channel inventory: ONLY Linq reports delivery outcomes to web
  (`HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH` is the sole egress-delivery
  route; Telegram sends via providerFetch with no outcome callback, email
  send returns only `{target}`, WhatsApp has send types but no egress
  path). Consequence: the watermark advances only for Linq-answered turns.
  Channels without a callback keep exactly today's behavior; the checkpoint
  ack they nominally had never fired anyway (~0 acks/week), so deleting it
  regresses nothing. This constraint GATES the direct wake in Part 1b (see below).

Coverage computation (verified design, hardened by adversarial review):
- Compute in the auto-reply frame (`automation/reply.ts:1453-1520`), but
  the scan input is the PERSISTED input store's conversation-lane staged
  inputs ordered by laneSeq — NOT the current reply context or candidate
  set (which is per-channel and context-bound and can over-claim past a
  pending input from another channel, another Linq conversation, or a
  thread-route/group item). Walk the lane-ordered prefix, stop at the
  first input lacking terminal evidence, stamp that high water.
- Suppression IS valid terminal evidence for the scan
  (`hasCompleteAssistantAutoReplyTerminalEvidence` includes it, correctly):
  a suppressed input re-suppresses on re-run, so covering it is safe and
  desirable. The "no-reply turns get no ack" rule means only that a
  suppressed turn produces no ack VEHICLE of its own — its inputs are
  covered by the next delivered reply's scan.
- Reaction-only sends (`setLinqMessageReaction`) do not emit the delivery
  callback and are not reply coverage; a reaction-only turn's inputs are
  likewise covered by the next delivered reply. No callback added for
  them (measured-need rule).
- Required tests: telegram-pending-below-linq-answered hold-back;
  suppressed-prefix advance; group/thread-route item interleave; steered
  multi-final turn; input staged mid-turn (arrives after scan snapshot —
  must not be covered).
- Thread as one optional field: intent schema
  (`assistant-cli-contracts.ts:816`) → create input (`outbox.ts:245`) →
  delivery payload (`side-effects.ts:107`) →
  `buildHostedAssistantDeliveryPayloadFromIntent` (`callbacks.ts:3313`) →
  send dependency (`callbacks.ts:2190-2216`) → outcome request
  (`platform.ts:217`, `callbacks.ts:2535-2567`) → web route/store.
  The full intent is NOT in scope at report-build time (only intentId is
  captured); the payload/effect carrier is the path.
- Stamped-at-create + advance-on-accept is provably safe: idempotency keys
  are minted once and reused across retries; only the provider-accept path
  emits `acceptedAt`; the web route enforces accepted/failed XOR; the
  store's advance is monotonic so out-of-order accepts cannot regress.
- Advance on ANY accepted outcome carrying coverage — not only on a
  newly-accepted transition. The advance is monotonic-max, so replays are
  free, and the deploy window requires it: new runner → old web records
  accepted but ignores coverage; the retry hitting new web finds the row
  already accepted and must still advance.
- Rollback care: `assistantOutboxIntentSchema` is `.strict()`. A new
  runner writing the field then rolling back to an old runner must not
  brick outbox-state parsing. Follow the repo's outbox schema-evolution
  precedent (accept-and-ignore first if none exists: land the schema field
  in one runner release before the producer).

Riders (independent deletions, separate commits):
- Mailbox-fetch AI-usage gate: KEEP (rider withdrawn by adversarial
  review). The original safe-to-delete verdict assumed every wake
  traverses turn admission in reconciliation facts — true only for
  Temporal-orchestrated wakes. A direct-woken container (Part 1b, or the
  legacy workflow branch until PR 2) fetches the mailbox WITHOUT ever
  reading reconciliation facts, so the read-first fetch gate is the only
  usage check on the fast path. It is cheap (fires only when the batch
  contains gated work) and becomes load-bearing under the direct wake. Deleting it
  would require runtime-local admission — complexity in the wrong
  direction.
- Relocate (NOT delete) `readRecordedHostedLinqFirstContactAdmissionDecision`:
  keyed by unique `eventId` (schema:951-961) so fresh events always read
  null; it is load-bearing only for retried deliveries (idempotent
  classifier/budget). Move the read inside the
  `plan.firstContactAdmissionRequest` branch (`webhook-service.ts:217+`):
  recorded allow/block → act without re-classifying; else classify. Only
  behavioral cost: a blocked-contact RETRY runs one extra side-effect-free
  plan transaction before short-circuiting. `recordedAdmission` has no
  other consumers (webhook-service.ts:202,210).

#### Part 1b — re-land the direct wake (revert of 3c2a41bda2)

Restores the PR #362 fast path with a durable-ordering guard: webhook first
gets the unconditional Temporal mailbox-append signal accepted, then fires a
fire-and-forget ensure at the Cloudflare worker instead of waiting for the
Temporal worker to dispatch the same ensure. ~643 withdrawn lines return (web
wake helper, CF dual-auth ensure route, control-client method,
`triggeredByWebDirect` trace leaf, E2E).
With Part 1a live, racing ensures are harmless by construction: a stale
invocation fetches the mailbox, sees input consumed (null reply target),
finds no fresh work, exits.

GATE — Linq only: the direct wake fires only for `source === "linq"`,
because only Linq's reply path advances the watermark (Part 1a channel
inventory). Firing it for Telegram/WhatsApp would reintroduce the #362
duplicate hazard on channels with no delivery-time consume authority. One
guarded condition in the shared wake helper, with the enabling rule named
in a comment: a channel earns the fast path by growing a delivery-outcome
callback. This composes instead of branching per provider ad hoc.

Residual risk (documented, accepted): a dual-channel member whose turn
answers a Telegram input during Linq-wake churn could still see a
re-answered Telegram input in an inter-invocation gap — that window exists
today under Temporal retries; the direct wake makes gaps marginally more frequent for
dual-channel members only. The measured trigger for closing it is a
Telegram delivery callback, not speculative coordination.

- No workflow-side coordination, no new flags, no deploy-order dance
  between web and worker beyond web-first for the trace leaf. The protocol
  doc's withdrawal constraint ("any future direct wake must carry pointer
  awareness into the workflow") is satisfied by Part 1a's lag netting instead
  of a signal flag — update `hosted-runtime-protocol.md:268-274` to record
  that resolution in this PR.
- Failure-mode ledger with Part 1a live: duplicate reply → impossible (consumed
  items re-stage with null reply target); redundant ensure racing an active
  invocation → `already_running` on the DO fence; ensure landing in an
  inter-invocation gap → starts an invocation that imports, finds nothing
  replyable, exits (bounded compute waste, shrinking to ~zero once the
  delivery ack lands within seconds).
- The instrumented rapid-double-webhook E2E that killed #362 becomes the
  regression proof.

Deploy-window analysis for the merged PR (replaces the old staged gate):
- Web deploys first. The wake helper fires at a Cloudflare route that does
  not exist yet → fire-and-forget 404, harmless no-op. The delivery route
  accepts-but-never-receives coverage; lag netting is live but inert
  (consumed_seq still 0 everywhere). Net: behavior identical to today.
- Cloudflare deploys second (worker route + runner bundle ship together in
  the hosted-execution deploy), with `container_rollout=immediate` so old
  runner containers — which do not post coverage — are recycled rather
  than left delivering coverage-less replies.
- Residual one-window risk, accepted and documented: a duplicate would
  require a direct wake racing an ensure into an inter-invocation gap for
  a message whose reply was delivered by a still-running OLD container
  during the minutes between web and CF deploys. With the 404 gating (the
  wake route only exists once CF deploys, i.e. once new runners exist)
  this shrinks to old-container stragglers under immediate rollout —
  narrower than the ordinary risk of any hosted deploy.
- Post-deploy verification before calling it done: one prod observation of
  `consumed_seq` advancing at delivery time, and `triggeredByWebDirect`
  appearing in orchestration traces.

### PR 2 — retire the legacy workflow patch branch + collapse the wake fields

Pure cleanup, no behavior. Merges after the patch drain is observed (the
wake-field collapse has no precondition and simply rides along — the cost
of two PRs instead of four, accepted).

#### Part 2a — retire the legacy workflow patch branch (pure deletion)

Exploration collapsed the original "demote to recheck-only" design: the
patched workflow already IS recheck-shaped — on `mailbox_appended` it only
bumps a signal version, re-reads reconciliation facts, and ensures on lag
(`hosted-user-runtime.ts:308-379`). With Part 1a's lag netting, that loop
becomes the correct deferred backstop with zero workflow changes: the one
ensure it fires while a direct-woken invocation is running no-ops against
the DO fence, and post-delivery rechecks see lag 0. Adding a delay timer +
a second `patched()` marker + a replay fixture to avoid one no-op RPC per
message fails the measured-bottleneck rule — deleted from the plan.

What remains is retiring the one legacy branch: the unpatched direct-ensure
path (`hosted-user-runtime.ts:294-306`, gated by
`hosted-runtime-reconcile-before-mailbox-processing` — a Temporal replay
marker, not config; every post-patch execution already runs reconcile-first,
only pre-patch histories still in flight take the legacy branch).
Per `agent-docs/references/hosted-temporal-orchestration.md:232-263` (this
would be the repo's first patch retirement):
1. `deprecatePatch(...)` intermediate once pre-patch histories have drained
   (per-user workflows recycle via continue-as-new, so drain is observable).
2. Then delete the branch, the runtime seam, the patch-id constant,
   `recordDirectMailboxProcessingSummary`, and the guard-required replay
   test/fixture in the same change (`hosted-temporal:guard` pins them).

#### Part 2b — wake-field triple collapse (net deletion)

Drop the four singular plan fields (`wakeLinqChatId`, `wakeMailboxCheckpoint`,
`wakeMailboxItemId`, `wakeUserId` — `webhook-service-types.ts:22-25`) and
make the existing `wakeHandoffs` array the sole wake shape; WhatsApp already
emits only handoffs and `webhook-service-wake.ts` is already the unified
sink (unchanged). Linq/Telegram planners emit 0-1 handoffs; handler-level
hardcoded eventId/source move into the handoff where those fields already
exist.

Semantics that must be explicitly preserved (verified inventory):
1. Duplicate wakes stay checkpoint-ABSENT per handoff (Linq duplicate
   branches deliberately take the legacy repairing signal path;
   `webhook-provider-linq.ts:554-558,1122-1127`) — checkpoint stays
   optional per handoff, never forced.
2. Family-notification wakes target the ACCEPTING member with no
   checkpoint (`webhook-provider-telegram.ts:104-109`,
   whatsapp:370-378).
3. Linq read receipts keep reading the handoff's `linqChatId`
   (service:388) and `linqReadReceiptRouteAuthority` stays a PLAN-level
   field (Linq-only concern; do not push into the shared handoff shape).
4. `wakeHandoffs` stays an array (WhatsApp emits one per inbound text).

Touch: `webhook-service-types.ts:17-26`;
`webhook-service.ts:336-356,388,605-613,663`;
`webhook-provider-linq.ts:557-558,671-677,1121-1127,1221-1228`;
`webhook-provider-telegram.ts:104-109,172-177`.

## Deploy order

- PR 1: web first, then Cloudflare (worker + runner bundle) with
  `container_rollout=immediate` — full analysis in Part 1b. Old runner +
  new web = today's behavior; new runner + old web = coverage field
  ignored (the monotonic advance-on-any-accepted rule makes later retries
  converge). Delete the `/consume` route in this PR only if the optional
  port wiring provably tolerates its absence during the window (the port
  is optional and the old runner's post-checkpoint call is caught
  best-effort with a retry wake — verify the 404 path in the E2E);
  otherwise route deletion trails in PR 2.
- PR 2: Render worker deploy (Temporal patch retirement, two-phase per the
  repo's patch procedure: `deprecatePatch` intermediate after drain, then
  branch deletion) + web (wake-field collapse, no deploy coupling).

## Verification

- PR 1: focused runtime tests for coverage stamping (multi-message turn,
  cross-channel interleave hold-back, failed-reply hold-back, suppressed
  prefix, mid-turn staging); web route test for advance-on-any-accepted
  with coverage; the restored #362 E2E suite including the
  rapid-double-webhook scenario and the Linq delivery E2E that was the
  original failure signal, 2 consecutive green runs; prod readback of
  `consumed_seq` advancing at delivery.
- PR 2: workflow replay tests per the patch procedure + Temporal
  orchestration E2E; full webhook owner suites for the wake-field
  collapse.
- Each PR: c1 (codex gpt-5.5 xhigh) deep-review rounds to completion.

## Deletion ledger (running total)

| PR | Deleted | Added |
| --- | --- | --- |
| 1 | ~220-line checkpoint ack block, consume route+port+compat wiring, dead lag export, every-message admission pre-read (relocated) | intent field, report field, 1 store call, lag netting (explicit param, both callers audited), ~500 restored direct-wake lines (stateless hint; no new state/concepts) |
| 2 | legacy patch branch, runtime seam, patch constant, direct-summary recorder, replay fixture+test, four legacy wake plan fields + parallel consumers | `deprecatePatch` intermediate (itself later deleted) |

Plan-level collapse already banked: the original PR C ("demote workflow to
recheck-only": delay timer, second patch marker, new replay fixture) was
deleted from this plan — PR A's lag netting makes the existing patched
reconcile loop the correct backstop as-is.

Adversarial review (c1 gpt-5.5 xhigh, 2026-07-03) resolutions: fetch-gate
deletion withdrawn (it is the only usage check on the direct-wake path);
coverage scan pinned to the persisted lane prefix, not context candidates;
suppression counts as terminal for coverage; lag netting made an explicit
parameter with the status route audited alongside; watermark advances on
any accepted+coverage report (replay/deploy-window safe); reaction-only
sends excluded from callback assumptions.
