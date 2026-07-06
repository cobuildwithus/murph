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

#### Part 1a — delivery-time consume stamp (net deletion)

The runtime already reports every Linq delivery outcome to
`POST /api/internal/hosted-runtime/linq-egress/delivery`
(`apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts`),
with `acceptedAt`/`failedAt`, intent id, idempotency key, and provider ids.
Accepted reply delivery is the consume authority for the exact mailbox items
that reply answered. The durable fact is a single nullable column on the item
row:

- `HostedMailboxItem.consumedAt DateTime? @map("consumed_at")`.
- Nullable additive migration only; no backfill, no index, no side table.
- The existing checkpoint-time `consumed_seq` lane watermark stays in place and
  is not advanced at delivery time.

Implementation shape:

1. `createHostedAutoReplyDeliveryIdempotency` already computes answered inbound
   ids as `hostedMailboxItemIds`. Persist that same list on the outbox intent as
   `answeredMailboxItemIds: string[]` so prepared retries resend the same consume
   authority.
2. Forward `answeredMailboxItemIds` through hosted delivery side effects,
   callbacks, the runtime platform outcome request, and the web delivery route.
   Reminders, notifications, reactions, no-reply turns, and failed/skipped sends
   send an empty list and consume nothing.
3. The web delivery route parses the list only on `acceptedAt`, dedupes it, and
   rejects more than 40 ids. `userId` comes from
   `requireHostedCloudflareCallbackRequest`, never from the request body.
4. `recordHostedLinqRuntimeDeliveryOutcomeTx` stamps inside its existing
   transaction:

   ```ts
   updateMany where { id: { in: ids }, userId, lane: 'conversation', kind: 'conversation.message', consumedAt: null }
              data  { consumedAt: acceptedAt }
   ```

   This is intentionally an idempotent, same-user, same-lane update with no
   decrypt, no payload re-parse, no contiguity scan, and no per-item read loop.
5. Mailbox fetch returns each item's `consumedAt`. The AI-usage gate treats
   rows with `consumedAt != null` as already handled, matching the existing
   `consumedSeq` replay behavior.
6. Runtime mailbox import treats a conversation item as durably consumed when
   `consumedAt != null` OR `laneSeq <= consumedSeq`. Durably consumed
   conversation rows restage as context-only with a null reply target and never
   become reply candidates.

Accepted tradeoff: this PR does not add derived-floor SQL or lag netting. After
Part 1b, Temporal may continue issuing harmless best-effort ensures until the
next checkpoint publishes `importedSeq`. With `consumed_at` live, those ensures
find no replyable consumed item; avoiding the no-op wake would require extra
state and is not justified by measured bottleneck evidence.

Deletion ledger:
- Delete `stageHostedConversationMailboxConsumedAckBestEffort`, its four skip
  gates, `consume_ack_skipped` logging, failure logging, and coverage resolver
  from `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`.
- Delete `/api/internal/hosted-mailbox/consume`.
- Delete `HostedMailboxPort.consume` and the abort-guard/deploy-window wiring
  that kept it optional.
- Delete dead `isHostedMailboxLaneCheckpointed` from
  `apps/web/src/lib/hosted-mailbox/lag.ts`.
- Keep `advanceHostedMailboxConsumedSeqByLane` and checkpoint-time
  `consumed_seq` unchanged; they remain legacy replay-floor support.

Design constraints:
- No join table, proof object, `consumeRequired` flag, derived-floor SQL, lag
  netting, replay receipt repair, or Linq-specific consume subsystem.
- A bad item id can only mark one row owned by the same authenticated user; the
  route never trusts body-provided user identity.
- Interleaved conversation lanes stay safe because consume authority is per row,
  not a high-water. A Linq reply for seq 7 can consume seq 7 while a pending
  cross-channel seq 6 remains replyable.
- Failed or skipped outcomes consume nothing. Scheduled reminders,
  notifications, and reactions consume nothing.
- Account deletion needs no cascade table: the stamp is on `hosted_mailbox_item`
  and disappears with the row.

#### Part 1b — re-land the direct wake (revert of 3c2a41bda2)

A separate pass restores the PR #362 fast path with the new safety condition:
the Linq webhook first fires the unconditional Temporal signal, then
best-effort fire-and-forget ensures the Cloudflare worker directly. The
withdrawn web wake helper, Cloudflare dual-auth ensure route, control-client
method, `triggeredByWebDirect` trace leaf, and E2E return. With Part 1a live,
racing ensures are harmless by construction: a stale invocation fetches the
mailbox, sees input consumed (null reply target), finds no fresh work, exits.

GATE — Linq only: the direct wake fires only for `source === "linq"`, because
only Linq reply delivery carries delivery-time `consumed_at` authority in Part
1a. Firing it for Telegram/WhatsApp would reintroduce the #362 duplicate hazard
on channels with no delivery-time consume authority. One guarded condition in
the shared wake helper, with the enabling rule named in a comment: a channel
earns the fast path by growing a delivery-outcome callback. This composes
instead of branching per provider ad hoc.

Residual risk (documented, accepted): a dual-channel member whose turn
answers a Telegram input during Linq-wake churn could still see a
re-answered Telegram input in an inter-invocation gap — that window exists
today under Temporal retries; the direct wake makes gaps marginally more frequent for
dual-channel members only. The measured trigger for closing it is a
Telegram delivery callback, not speculative coordination.

- No workflow-side coordination, no new flags, and no lag netting. The protocol
  doc's withdrawal constraint ("any future direct wake must carry pointer
  awareness into the workflow") is resolved by Part 1a's `consumed_at` restage
  behavior instead of a signal flag: a directly woken invocation imports the
  same pointer, but consumed rows are context-only and cannot be reply targets.
- Failure-mode ledger with Part 1a live: duplicate reply → impossible (consumed
  items re-stage with null reply target); redundant ensure racing an active
  invocation → `already_running` on the DO fence; ensure landing in an
  inter-invocation gap → starts an invocation that imports, finds nothing
  replyable, exits. Temporal may continue backstop ensures until the next
  checkpoint; those are accepted bounded no-op compute rather than a reason to
  add derived-floor state.
- The instrumented rapid-double-webhook E2E that killed #362 becomes the
  regression proof.

Deploy-window analysis for the full Part 1a + Part 1b PR:
- Web deploys first. The wake helper fires at a Cloudflare route that does
  not exist yet → fire-and-forget 404, harmless no-op. The delivery route can
  accept `answeredMailboxItemIds` and stamp `consumed_at`; old runners simply
  do not send the field. Net: behavior identical to today until new runners
  ship.
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
- Post-deploy verification before calling it done: one prod observation of an
  accepted Linq reply stamping `hosted_mailbox_item.consumed_at`, and
  `triggeredByWebDirect` appearing in orchestration traces after Part 1b.

### PR 2 — retire the legacy workflow patch branch + collapse the wake fields

Pure cleanup, no behavior. Merges after the patch drain is observed (the
wake-field collapse has no precondition and simply rides along — the cost
of two PRs instead of four, accepted).

#### Part 2a — retire the legacy workflow patch branch (pure deletion)

Exploration collapsed the original "demote to recheck-only" design: the
patched workflow already IS recheck-shaped — on `mailbox_appended` it only
bumps a signal version, re-reads reconciliation facts, and ensures on lag
(`hosted-user-runtime.ts:308-379`). With Part 1a's `consumed_at` restage
behavior, that loop remains the correct deferred backstop with zero workflow
changes: ensures racing an active direct-woken invocation no-op against the DO
fence, and post-delivery rechecks may issue harmless ensures that import
consumed rows as context-only. Adding derived-floor SQL, lag netting, a delay
timer, a second `patched()` marker, or a replay fixture to avoid one no-op RPC
per message fails the measured-bottleneck rule — deleted from the plan.

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
  `container_rollout=immediate` — full analysis in Part 1b. Old runner + new
  web = today's behavior; new runner + old web = the delivery route ignores
  unknown `answeredMailboxItemIds` until web lands, so accepted replies converge
  on a prepared retry after web deployment. The `/consume` route and optional
  runtime port are deleted in Part 1a; the old post-checkpoint consume ack was
  best-effort and no longer owns reply safety.
- PR 2: Render worker deploy (Temporal patch retirement, two-phase per the
  repo's patch procedure: `deprecatePatch` intermediate after drain, then
  branch deletion) + web (wake-field collapse, no deploy coupling).

## Verification

- PR 1: focused runtime tests for delivery-time `consumed_at` stamping
  (multi-message turn, accepted-behind-gap, failed/skipped outcomes, prepared
  retry id persistence, scheduled reminder/notification empty ids, restart
  restage context-only); web route/store tests for same-user idempotent
  `updateMany`; the restored #362 E2E suite in Part 1b including the
  rapid-double-webhook scenario and the Linq delivery E2E, 2 consecutive green
  runs; prod readback of `hosted_mailbox_item.consumed_at` after accepted
  delivery.
- PR 2: workflow replay tests per the patch procedure + Temporal
  orchestration E2E; full webhook owner suites for the wake-field
  collapse.
- Each PR: c1 (codex gpt-5.5 xhigh) deep-review rounds to completion.

## Deletion ledger (running total)

| PR | Deleted | Added |
| --- | --- | --- |
| 1 | checkpoint ack block, consume route+port+compat wiring, dead lag export, every-message admission pre-read (relocated) | one nullable item stamp, one intent/report field, one idempotent store update, restored direct-wake lines in Part 1b (stateless hint; no new state/concepts) |
| 2 | legacy patch branch, runtime seam, patch constant, direct-summary recorder, replay fixture+test, four legacy wake plan fields + parallel consumers | `deprecatePatch` intermediate (itself later deleted) |

Plan-level collapse already banked: the original PR C ("demote workflow to
recheck-only": delay timer, second patch marker, new replay fixture) was
deleted from this plan — Part 1a's `consumed_at` restage behavior makes the
existing patched reconcile loop a harmless backstop as-is.

Adversarial review (c1 gpt-5.5 xhigh, 2026-07-03) resolutions: fetch-gate
deletion withdrawn (it is the only usage check on the direct-wake path);
coverage scan replaced by explicit answered item ids; no lag netting or
derived-floor SQL; per-item `consumed_at` avoids advancing a lane high-water
past gaps; reaction-only sends excluded from callback assumptions.
