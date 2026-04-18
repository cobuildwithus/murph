# Hosted Hard-Cut Migration Guide

Status snapshot: 2026-04-18

## Final verdict

The web-owned hosted-wake substrate is in place and should stay. Most hosted
producers already append canonical wake rows. The hard cut is still unfinished
because the shared contract, runtime execution loop, and Cloudflare runner still
carry dispatch-era semantics and duplicate lifecycle ownership.

## What is already landed and should not be reopened

### 1. Web owns the canonical wake and cursor substrate

Evidence:

- `apps/web/prisma/migrations/202604171900_hosted_wake_substrate/`
- `apps/web/prisma/migrations/202604172330_hosted_wake_payload_spill/`
- `apps/web/prisma/migrations/202604180100_drop_execution_outbox/`
- `apps/web/src/lib/hosted-wake/store.ts`
- `apps/web/app/api/internal/hosted-wake/{append,commit,quarantine,repair,status,unseen}/route.ts`

Why this stays:

- `HostedWake` and `HostedExecutionCursor` are already the canonical ordering,
  payload-storage, and compare-and-swap ownership seam.
- Payload spillover and cursor `version` fencing are the right long-term shape.

### 2. Most producers already append into `HostedWake`

Evidence:

- active-member Linq webhook: `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- active-member Telegram webhook: `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
- member activation: `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- member channel sync: `apps/web/src/lib/hosted-onboarding/member-channel-sync.ts`
- device-sync signals: `apps/web/src/lib/device-sync/wake-service.ts`
- share acceptance: `apps/web/src/lib/hosted-share/acceptance-service.ts`
- hosted email ingress: `apps/cloudflare/src/hosted-email/worker-ingress.ts`

Why this matters:

- The remaining work is no longer “move producers onto HostedWake.”
- The remaining work is “stop wrapping those canonical wakes in dispatch-era
  contracts and delete the leftover lifecycle owners around them.”

### 3. Cloudflare already drains from web and commits back to web

Evidence:

- web fetch/commit/quarantine/status calls: `apps/cloudflare/src/web-control-plane.ts`
- wake drain loop: `apps/cloudflare/src/user-runner.ts`

Why this stays:

- The right data flow already exists: fetch unseen wakes from web, execute, then
  commit the cursor back into web-owned Postgres.

### 4. The runtime already split message vs system handling once

Evidence:

- `packages/assistant-runtime/src/hosted-runtime/events.ts`

Why this matters:

- The repo no longer needs a brand-new runtime split.
- It needs the existing split to become the real execution boundary instead of
  an internal branch underneath a still-generic dispatch model.

## Deduplicated remaining gaps

### 1. Shared hosted contracts are still dispatch-era contracts

Status: not done

Evidence:

- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/builders.ts`
- `packages/hosted-execution/src/parsers.ts`
- `apps/web/app/api/internal/hosted-wake/append/route.ts`
- `apps/cloudflare/src/web-control-plane.ts`

Current state:

- The shared surface still revolves around `HostedExecutionDispatchRequest`.
- Message wakes are still top-level provider kinds:
  - `linq.message.received`
  - `telegram.message.received`
  - `email.message.received`
- System wakes still store full dispatch envelopes under
  `HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA`.

What to fix:

- Replace the dispatch-shaped shared contract with a canonical hosted wake
  contract.
- Collapse message ingress onto one canonical message wake shape instead of
  provider-specific top-level event kinds.

Recommended end state:

- `conversation.message`
- `member.activated`
- `member.channels.updated`
- `share.accepted`
- `device-sync.wake`
- `assistant.cron.tick`

For messages, keep channel-specific payload detail under the message payload, not
as separate top-level wake kinds.

### 2. Active-member webhooks still flow through the receipt wrapper

Status: partial

Evidence:

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-engine.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`

Current state:

- Linq and Telegram active-member paths append direct wake payloads.
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts` now routes those
  active-member responses through a dedicated fast path instead of directly
  calling `runHostedWebhookWithReceipt(...)` on the hot path.
- Receipt ownership still exists for duplicate claim/completion and for
  onboarding/quota/local-side-effect flows, but no longer owns the active
  message payload lifecycle.

What remains:

- Keep tightening receipt usage so active-message retries depend only on the
  minimal duplicate/claim state that is still justified.
- Leave invite/quota/local-side-effect flows on the receipt-managed lane until
  they are migrated or explicitly retired.

### 3. Runtime message wakes no longer force the generic maintenance loop

Status: landed in this batch, with follow-up cleanup still remaining

Evidence:

- lane split: `packages/assistant-runtime/src/hosted-runtime/events.ts`
- maintenance coupling: `packages/assistant-runtime/src/hosted-runtime/execution.ts`

Current state:

- `events.ts` routes message wakes and system wakes separately.
- Ordinary Linq, Telegram, and email wakes now return
  `maintenanceRequired: false`.
- `execution.ts` only runs `runHostedMaintenanceLoop(...)` when
  `maintenanceRequired` is true, so ordinary conversation turns stay on the
  conversation lane.

What remains:

- Keep provider-specific event helpers constrained to capture normalization.
- Finish removing dispatch-envelope terminology from the remaining shared
  runtime contracts.

### 4. Cloudflare still carries a second queue architecture

Status: partial

Evidence:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/src/user-runner/runner-queue-schema.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`

Current state:

- Cloudflare already fetches wake rows from web and commits the cursor back to web.
- The Durable Object still persists `pending_events`, `consumed_events`,
  `poisoned_events`, local dispatch status, and bundle-slot metadata through
  `RunnerQueueStore`.
- Local fallback status is still exposed when web status reads fail.

What to fix:

- Remove Cloudflare-owned queue truth.
- Keep only the state Cloudflare actually needs:
  - active run lease / epoch
  - in-flight run status
  - next wake time
  - latest cached bundle ref for warm reuse

Web must remain the only owner of:

- ordering
- pending count
- poison/quarantine truth
- committed high-water
- snapshot pointer truth

### 5. Email is on canonical wake append but not on the final message contract

Status: partial

Evidence:

- producer: `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- runtime ingest: `packages/assistant-runtime/src/hosted-runtime/events/email.ts`

Current state:

- Hosted email ingress appends into web-owned `HostedWake`.
- It still does so by building `HostedExecutionDispatchRequest` with
  `email.message.received`.

What to fix:

- Move email onto the same canonical message wake contract as Linq and Telegram.
- Keep the runtime email normalization helper, but feed it from the final message
  payload rather than a provider-specific dispatch envelope.

## Report deltas to carry forward

These are the key places where the supplied analyses need updating before they
drive implementation:

- “Active-member Linq/Telegram append canonical wakes directly” is already true.
- “System producers are only partially cut over” is no longer the main gap.
  Activation, channel sync, device-sync, share acceptance, and hosted email all
  already land in `HostedWake`; the real remaining issue is that they still wrap
  those wakes in dispatch-era envelopes.
- “Cloudflare still owns a second queue architecture” remains true.
- “Runtime message turns still go through generic dispatch/event layering”
  remains partly true, but the maintenance coupling is no longer the main gap.
  Message wakes now stay on the conversation lane without forcing the generic
  maintenance loop; the remaining work is to finish deleting the dispatch-era
  envelope and adapter surfaces that still shape those wakes.

## Ordered migration phases

### Phase 1. Hard-cut the shared contract

Primary files:

- `packages/hosted-execution/src/{contracts,builders,parsers}.ts`
- `apps/web/app/api/internal/hosted-wake/append/route.ts`
- `apps/cloudflare/src/web-control-plane.ts`

Tasks:

- Replace `HostedExecutionDispatchRequest` as the canonical wake append surface.
- Introduce one canonical message wake contract with a `channel` field and
  channel-specific payload details.
- Stop storing new system wakes as full dispatch envelopes once the direct wake
  contract exists.

Acceptance:

- No new producer needs `HostedExecutionDispatchRequest` just to append a wake.
- New message wakes no longer use top-level provider-specific kinds.

### Phase 2. Tighten the active-member webhook fast path

Primary files:

- `apps/web/src/lib/hosted-onboarding/{webhook-service,webhook-provider-linq,webhook-provider-telegram}.ts`

Status in this repo: partially landed in this batch.

Tasks:

- Keep the active-member direct append-plus-nudge path as the only hot-path
  owner for Linq and Telegram message ingress.
- Keep receipt-managed flows only for invite/quota/local side effects and the
  minimal duplicate-claim semantics still required during the transition.
- Keep best-effort wake nudging derived from the appended wake target.

Acceptance:

- Active-member Linq and Telegram webhook message handling no longer directly
  calls `runHostedWebhookWithReceipt(...)` on the hot path.
- Receipt-managed continuation only remains where local side effects still need
  it.

### Phase 3. Finish the runtime conversation lane

Primary files:

- `packages/assistant-runtime/src/hosted-runtime/{execution,events}.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/**`

Status in this repo: substantially landed in this batch.

Tasks:

- Preserve the new `maintenanceRequired` gate so conversation wakes execute only
  the capture/conversation path.
- Keep generic maintenance ownership on explicit system wakes.
- Keep provider-specific modules as message parsing/normalization helpers only.

Acceptance:

- A normal conversation wake does not trigger the generic maintenance sweep.

### Phase 4. Cut Cloudflare down to the thin shim

Primary files:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/{runner-queue-store,runner-queue-schema,runner-dispatch-processor,runner-scheduler,types}.ts`

Tasks:

- Remove local queue truth for pending, consumed, and poisoned event history.
- Keep only lease/run/bundle-cache/alarm state.
- Make user and event status derive from web-owned wake lifecycle by default.

Acceptance:

- Cloudflare no longer persists queue correctness state that can disagree with
  web-owned wake lifecycle state.

### Phase 5. Move email and any stragglers onto the same final wake contract

Primary files:

- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/email.ts`

Tasks:

- Switch email from `email.message.received` dispatch envelopes to the final
  message wake contract.
- Remove compatibility-only parsing once all producers are moved.

Acceptance:

- Linq, Telegram, and email all enter the runtime through the same top-level
  message wake kind.

### Phase 6. Delete the legacy surfaces and rewrite docs

Primary files:

- stale hosted-execution builders/parsers/helpers
- stale Cloudflare queue helpers
- durable docs that still describe dispatch-era ownership

Tasks:

- Delete unused dispatch-only builders, parsers, tests, and status helpers.
- Update durable docs once the final owner boundaries are real.

Acceptance:

- No canonical hosted runtime doc still describes dispatch envelopes or
  Cloudflare-owned queue truth as the steady-state architecture.

## Current session parallelization plan

### Batch 1: implement now

These lanes are independent enough to run in parallel in the shared worktree.

1. `apps/web` active-member webhook fast path
   - landed in this batch
   - keep onboarding/quota side-effect flows intact while shrinking leftover
     receipt ownership further

2. `packages/assistant-runtime` conversation-lane cleanup
   - landed in this batch
   - keep message wakes off the generic maintenance loop

3. `apps/cloudflare` thin-shim cleanup
   - reduce local queue/status ownership further toward lease/run/bundle-cache only

### Batch 2: integrate after Batch 1

This lane overlaps every hosted surface and should wait until the first batch is
integrated.

4. shared hosted-execution contract hard cut
   - replace dispatch-shaped wake contracts with the final canonical wake surface
   - move email and remaining producers onto that final contract

## Exit criteria for the full hard cut

- Web/Postgres is the only owner of hosted wake ordering, lifecycle, cursor
  state, and snapshot pointer truth.
- All producers append canonical wake contracts directly, not
  `HostedExecutionDispatchRequest`.
- Active-member message ingress does not depend on the webhook receipt engine.
- Message wakes do not trigger the generic maintenance loop.
- Cloudflare Durable Objects no longer persist their own queue truth.
- The repo has no steady-state docs or tests that still treat dispatch-era
  envelopes as the canonical hosted execution model.
