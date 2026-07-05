# Mailbox Wake Latency + Complexity Collapse

Status: active
Updated: 2026-07-05

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
"answered" durable at reply delivery removes the replay hazard without
reintroducing a second wake authority.

Organizing constraint: the series must land net-negative in code,
concepts, and branches. Each PR carries a deletion ledger.

## PR sequence (two PRs)

### PR 1 — exact accepted item suppression + direct wake deletion

One PR, two pieces of shape: exact accepted item suppression and deletion
of the unsafe direct wake path. They deploy as one unit; the deploy-window
analysis below replaces the earlier staged four-PR gate.

#### Part 1a — delivery-report-as-exact-consumed-item (net deletion)

The runtime already reports every Linq delivery outcome to
`POST /api/internal/hosted-runtime/linq-egress/delivery`
(`apps/web/app/api/internal/hosted-runtime/linq-egress/delivery/route.ts`),
with `acceptedAt`/`failedAt`, intent id, idempotency key, and the current
inbound mailbox item set selected by the delivery context. Sent and consumed
become one exact item-set fact on one callback:

1. Forward the answered inbound mailbox item ids on the existing delivery
   report.
2. On `acceptedAt`, the delivery route validates the full current-inbound
   proof plus each answered mailbox item against mailbox payloads (item id,
   dedupe key for the proof item, event id for the proof item, occurred-at,
   reply-to message id for the proof item, target chat, user, lane/kind,
   non-self inbound, expiry, and routed account authority), then stores
   one child row per item for the accepted delivery.
3. Mailbox fetch/import treats those exact stored items as context-only on
   replay, including when a lower lane gap keeps the contiguous
   `consumed_seq` behind it.

The route does **not** advance `consumed_seq` from a runner-supplied lane
high-water. Normal mailbox import/checkpoint remains the owner of contiguous
lane progress. This keeps the fix exact, avoids a second high-water authority,
and preserves the lower-gap case without adding workflow-side coordination,
delay timers, or patch markers.

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
- Added: one accepted-delivery exact mailbox item set, forwarded from the
  existing current-inbound proof/input ids and validated in the existing route
  transaction.

Verified against source (2026-07-05):
- `recordHostedLinqRuntimeDeliveryOutcomeTx` runs inside
  `runHostedLinqDeliveryStoreTransaction` (`linq-delivery-store.ts:494`),
  so accepted delivery rows and their exact mailbox item set are recorded
  atomically. It early-exits `recorded: false` without an idempotency key;
  reaction/keyless sends never create an accepted-item fact, which is
  correct (a reaction is not a reply).

Design constraints (pinned by docs/contracts/00-invariants.md §42–45 and
hosted-runtime-protocol.md §519–526):
- The accepted delivery fact is exact-item only. It must never claim a
  contiguous lane prefix or advance through lower gaps from runner-supplied
  metadata.
- Never record exact consumed items on `failedAt`; retryable-not-terminal
  semantics are unchanged.
- No-reply turns (`finish_without_reply`) intentionally get no ack: a
  re-run re-suppresses (compute waste, never a user-visible duplicate).
  Add no-reply exact-item coverage only if churn data ever proves the cost
  (measured-bottleneck rule).
- VERIFIED channel inventory: ONLY Linq reports delivery outcomes to web
  (`HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH` is the sole egress-delivery
  route; Telegram sends via providerFetch with no outcome callback, email
  send returns only `{target}`, WhatsApp has send types but no egress
  path). Consequence: exact accepted-item suppression exists only for
  Linq-answered turns. Channels without a callback keep exactly today's behavior; the checkpoint
  ack they nominally had never fired anyway (~0 acks/week), so deleting it
  regresses nothing.

Exact accepted-item computation (verified design, hardened by adversarial review):
- Select the current inbound item in the delivery context before provider
  send; prefer an exact `replyToMessageId` match before same-target
  fallback.
- Forward the full `currentInbound` proof to web as consume authority. The
  legacy runtime-side high-water coverage path has been removed
  from outbox intents, receipt repair, auto-reply evidence, hosted delivery
  side effects, and runtime-to-web delivery outcomes.
- Persist the full `currentInbound` proof alongside the prepared Linq
  route/service authority so post-checkpoint prepared retries restore the
  same exact consume authority before provider send.
- The runtime must synchronously record accepted delivery outcomes whenever
  the accepted outcome carries `currentInbound.mailboxItemId` or
  `answeredMailboxItemIds`; the validated accepted item set is the only
  answer-consume authority.
- Progress Linq delivery may use `currentInbound` for the egress guard, but
  must not include it in delivery-outcome recording; progress is not
  terminal answer evidence.
- The web route validates the full current-inbound proof and answered item
  set against mailbox item payloads before persisting child rows. Routed inbound
  proof and outbound delivery authority must match on channel,
  container member, account lookup key, and thread id.
- Mailbox fetch/import turns matching accepted delivery rows into
  `consumedItems` so the exact accepted items are context-only even when the
  contiguous `consumed_seq` floor is held back by a lower gap.
- Accepted replays never recompute from mutable replay request bodies. If
  web did not store the exact item rows when the accepted fact was recorded,
  there is no durable authority left to consume from later.
- Rollback care: `assistantOutboxIntentSchema` is `.strict()`. A new
  runner writing the field then rolling back to an old runner must not
  brick outbox-state parsing. Follow the repo's outbox schema-evolution
  precedent (accept-and-ignore first if none exists: land the schema field
  in one runner release before the producer).

Riders (independent deletions, separate commits):
- Mailbox-fetch AI-usage gate: KEEP (rider withdrawn by adversarial
  review). With direct wake deleted, this PR no longer needs to touch that
  gate. Deleting it would need a separate proof that every mailbox fetch
  has already crossed equivalent admission; absent that proof, keeping the
  cheap read-first gate is the simpler safe choice.
- Relocate (NOT delete) `readRecordedHostedLinqFirstContactAdmissionDecision`:
  keyed by unique `eventId` (schema:951-961) so fresh events always read
  null; it is load-bearing only for retried deliveries (idempotent
  classifier/budget). Move the read inside the
  `plan.firstContactAdmissionRequest` branch (`webhook-service.ts:217+`):
  recorded allow/block → act without re-classifying; else classify. Only
  behavioral cost: a blocked-contact RETRY runs one extra side-effect-free
  plan transaction before short-circuiting. `recordedAdmission` has no
  other consumers (webhook-service.ts:202,210).

#### Part 1b — direct wake removed after authorization review

ReviewGPT round 18 found the re-landed web direct ensure path moved wake
authorization into a web-local branch: Cloudflare saw only Vercel OIDC plus a
fresh attempt id, not the durable mailbox append/signal tuple. The simplest
durable fix is deletion, not minting a new receipt protocol. Web now keeps the
unconditional Temporal mailbox-append signal as the wake authority; Cloudflare
`runtime/ensure-processing` is back to Temporal web-callback-signature only.

- No workflow-side coordination, no new flags, no deploy-order dance beyond
  web-first for the trace leaf. The protocol doc's withdrawal constraint
  ("any future direct wake must carry pointer awareness into the workflow")
  remains in force; this PR does not reland direct wake.
- Failure-mode ledger with Part 1a live: duplicate reply from accepted
  Linq delivery replay is suppressed by exact consumed items; lower mailbox
  gaps still keep contiguous `consumed_seq` honest; Temporal remains the
  only wake authority.
- The instrumented rapid-double-webhook E2E that killed #362 becomes the
  regression proof.

Deploy-window analysis for the merged PR (replaces the old staged gate):
- Web deploys first. The delivery route starts recording exact accepted item
  sets once runner payloads include current inbound proof and answered item ids; it does not
  advance `consumed_seq`.
- Cloudflare deploys second (worker route + runner bundle ship together in
  the hosted-execution deploy), with `container_rollout=immediate` so old
  runner containers are recycled into the exact-item context behavior.
- Post-deploy verification before calling it done: one prod accepted Linq
  delivery with rows in `hosted_linq_delivery_answered_mailbox_item`,
  followed by a replay/fetch where those items are context-only and not replyable; mismatched
  current-inbound proof, including mismatched route authority, must fail
  closed and not store item rows.

### PR 2 — retire the legacy workflow patch branch + collapse the wake fields

Pure cleanup, no behavior. Merges after the patch drain is observed (the
wake-field collapse has no precondition and simply rides along — the cost
of two PRs instead of four, accepted).

#### Part 2a — retire the legacy workflow patch branch (pure deletion)

Exploration collapsed the original "demote to recheck-only" design: the
patched workflow already IS recheck-shaped — on `mailbox_appended` it only
bumps a signal version, re-reads reconciliation facts, and ensures on lag
(`hosted-user-runtime.ts:308-379`). Since direct wake is not relanding in
PR 1, adding a delay timer + a second `patched()` marker + a replay fixture
fails the measured-bottleneck rule — deleted from the plan.

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
  new web = today's behavior; new runner + old web = legacy
  `currentInbound` ignored by the old delivery route, so exact consumed item
  suppression starts only after web deploys. The deleted `/consume` route is
  tolerated because the old runner's post-checkpoint call was optional
  best-effort and already had retry-wake fallback behavior.
- PR 2: Render worker deploy (Temporal patch retirement, two-phase per the
  repo's patch procedure: `deprecatePatch` intermediate after drain, then
  branch deletion) + web (wake-field collapse, no deploy coupling).

## Verification

- PR 1: focused runtime tests for exact Linq delivery context selection and
  exact accepted mailbox item replay/import; web route tests for exact
  current-inbound proof; the restored #362 E2E suite
  including the rapid-double-webhook scenario and the Linq delivery E2E
  that was the original failure signal, 2 consecutive green runs; prod
  readback of accepted delivery item rows in
  `hosted_linq_delivery_answered_mailbox_item`.
- PR 1 CI follow-up (2026-07-03): scheduled-reminder overlap coverage
  additionally proves foreground Linq sends are observed before due
  background reminders without the wait helper advancing hosted-local
  alarms.
- PR 1 CI follow-up (2026-07-03): the Linq webhook media fixture binds
  already-active home chats directly instead of creating signup-welcome
  chats, keeping active-member webhook assertions isolated from onboarding
  follow-up automation. Focused local proof:
  `pnpm hosted-local e2e linq-webhook --no-bundle` passed.
- PR 1 CI follow-up (2026-07-03): the rapid Linq webhook fixture now
  scripts the grouped reply twice because CI can start the provider on
  the first webhook and then steer the second webhook into that active
  turn, consuming a second Responses API completion. The PDF media case
  restarts the scenario before asserting attachment behavior so a failed
  or leftover rapid turn cannot steal its queued response. Focused local
  proof: `CI=true pnpm hosted-local e2e linq-webhook --no-bundle` passed.
- PR 1 CI follow-up (2026-07-03): CI then exposed the real duplicate-send
  window underneath that fixture: Linq provider acceptance returned before
  the background delivery-outcome write durably recorded the accepted
  delivery item, so a fresh auto-reply pass could prepare another send. The runner's
  pre-auto-reply delivery barrier now drains pending Linq outcome writes
  before importing fresh pre-dispatch work. Focused local proof:
  `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-runner.test.ts -t "pre-auto-reply delivery preparation drains pending Linq outcomes before fresh imports"`
  passed.
- PR 1 CI follow-up (2026-07-03): the next Linq webhook CI run proved a
  second, simpler duplicate path: active-turn input can replace the
  hosted auto-reply final delivery with a wider idempotency key while the
  initial unattempted final delivery remains on the same foreground
  boundary. The outbox collector now abandons superseded same-boundary
  hosted auto-reply finals when the current turn has a preferred final
  intent, preserving steered segments/reactions but preventing two Linq
  text replies from dispatching in one drain. Focused local proof:
  `pnpm --dir packages/assistant-runtime test -- hosted-runtime-callbacks.test.ts -t "abandons superseded hosted auto-reply same-boundary foreground replies"`
  and `CI=true pnpm hosted-local e2e linq-webhook --no-bundle` passed.
- PR 1 ReviewGPT round 24 follow-up: prepared Linq retries now persist and
  restore the full `currentInbound` proof, and runtime-to-web Linq delivery
  outcomes no longer include or synchronously depend on legacy high-water
  coverage.
  Focused local proof: hosted-runtime callback suite and assistant-engine
  outbox runtime suite passed.
- PR 1 ReviewGPT round 25 follow-up: foreground prepare now receives the
  full imported Linq context list, persists exact reply-id current-inbound
  proof instead of latest same-chat proof, and restores no-route prepared
  current-inbound proof into a minimal Linq context. Focused local proof:
  hosted-runtime callback suite and full workspace typecheck passed.
- PR 1 ReviewGPT round 26 follow-up: recovered Linq provider-thread delivery
  outcomes validate answered current-inbound proof against the original inbound
  target while recording the actual provider thread for delivery observability;
  the obsolete high-water coverage stack is deleted. Focused local proof:
  web Linq delivery route tests, hosted-execution side-effect tests,
  assistant-engine focused runtime tests, assistant-runtime hosted callback
  tests, assistantd HTTP tests, assistant-cli doctor/daemon coverage tests,
  and full workspace typecheck passed.
- PR 2: workflow replay tests per the patch procedure + Temporal
  orchestration E2E; full webhook owner suites for the wake-field
  collapse.
- Each PR: c1 (codex gpt-5.5 xhigh) deep-review rounds to completion.

## Deletion ledger (running total)

| PR | Deleted | Added |
| --- | --- | --- |
| 1 | ~220-line checkpoint ack block, consume route+port+compat wiring, dead lag export, every-message admission pre-read (relocated), re-landed web direct-wake fast path after authorization review, high-water consume helper and delivery-row lane coverage fields | exact answered item ids on the existing delivery report, accepted-delivery child rows |
| 2 | legacy patch branch, runtime seam, patch constant, direct-summary recorder, replay fixture+test, four legacy wake plan fields + parallel consumers | `deprecatePatch` intermediate (itself later deleted) |

Plan-level collapse already banked: the original PR C ("demote workflow to
recheck-only": delay timer, second patch marker, new replay fixture) was
deleted from this plan — direct wake was removed and the existing patched
reconcile loop remains the only wake authority.

Adversarial review (c1 gpt-5.5 xhigh, 2026-07-03) resolutions: fetch-gate
deletion withdrawn before direct-wake deletion made that path obsolete;
high-water consume authority rejected in favor of exact accepted mailbox
item facts; mailbox fetch exposes accepted delivery item ids for gap
suppression; dispatch reads pre-provider receipt metadata only for runtime
delivery-outcome durability; reaction-only sends excluded from callback
assumptions.
