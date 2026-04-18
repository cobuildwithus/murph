# Hosted Hard-Cut Migration Guide

Status snapshot: 2026-04-18

## Final verdict

The web-owned hosted-wake substrate is in place and should stay. Most hosted
producers append canonical wake rows, including email and the active-member
webhook hot path. The production hard cut is now effectively landed: Cloudflare
is on the wake/status/browser-vault control surface, direct dispatch RPCs are
gone from the production Durable Object boundary, and ordinary message wakes no
longer force the generic maintenance loop.

What remains is narrower and deletion-oriented:

- internal compatibility helpers still materialize `HostedExecutionDispatchRequest`
  from wakes inside shared packages
- some onboarding receipt state still exists for invite/quota/local side-effect
  flows
- a small set of test-only dispatch helpers still exists outside the production
  path

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

### 1. Shared hosted contracts are wake-first externally, with internal dispatch compatibility still present

Status: partial, but no longer a production-boundary blocker

Evidence:

- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/builders.ts`
- `packages/hosted-execution/src/parsers.ts`
- `apps/web/app/api/internal/hosted-wake/append/route.ts`
- `apps/cloudflare/src/web-control-plane.ts`

Current state:

- The append route and Cloudflare control-plane client are wake-first now.
- assistant-runtime now derives wakes locally when wake-native logic needs them,
  instead of depending on a populated `request.wake` field.
- Internal shared runtime contracts still carry `HostedExecutionDispatchRequest`
  as a compatibility surface behind that append boundary.
- New message wakes land as `conversation.message`, but dispatch-era provider
  event kinds still exist inside builders/parsers and runtime-facing helper
  types.
- Some system wakes still store full dispatch envelopes under
  `HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA`.

What to fix:

- Treat the remaining dispatch-shaped builders/parsers as compatibility-only.
- Delete them once test harnesses and the last internal callers stop needing
  them.

Recommended end state:

- `conversation.message`
- `member.activated`
- `member.channels.updated`
- `share.accepted`
- `device-sync.wake`
- `assistant.cron.tick`

For messages, keep channel-specific payload detail under the message payload, not
as separate top-level wake kinds.

### 2. Active-member webhooks append wakes directly and only keep receipt state for local side effects

Status: landed in this batch, with receipt-local follow-up still remaining

Evidence:

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-engine.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`

Current state:

- Linq and Telegram active-member paths append direct wake payloads.
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts` now routes those
  active-member responses through a dedicated fast path.
- Receipt ownership still exists for duplicate claim/completion and for
  onboarding/quota/local-side-effect flows, but no longer owns the active
  message payload lifecycle.

What remains:

- Keep tightening receipt usage so active-message retries depend only on the
  minimal duplicate/claim state that is still justified.
- Leave invite/quota/local-side-effect flows on the receipt-managed lane until
  they are migrated or explicitly retired.

### 3. Runtime message wakes no longer force the generic maintenance loop

Status: landed

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
- Keep the remaining dispatch-envelope terminology isolated to compatibility
  helpers rather than re-expanding it through the runtime boundary.

### 4. Cloudflare is now a thin wake runner instead of a second queue owner

Status: landed for production; test-only compatibility still exists

Evidence:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/src/user-runner/runner-queue-schema.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`

Current state:

- Cloudflare already fetches wake rows from web and commits the cursor back to web.
- The Durable Object schema now drops `pending_events`, `consumed_events`,
  `backpressured_events`, and `poisoned_events`.
- Production `UserRunnerDurableObject` no longer exposes `dispatch` or
  `dispatchWithOutcome` RPCs.
- Local completed-status reuse and the dispatch-payload-store plumbing are gone
  from the production runner path.
- `dispatchWithOutcome` degrades conservatively to `queued` when canonical wake
  status is unavailable instead of reconstructing local lifecycle truth.

What to fix:

- Keep Cloudflare limited to the state it still legitimately owns:
  - active run lease / epoch
  - in-flight run status
  - next wake time
  - latest cached bundle ref for warm reuse
- Delete the remaining test-only direct-dispatch helpers once the harnesses stop
  using them.

Web must remain the only owner of:

- ordering
- pending count
- poison/quarantine truth
- committed high-water
- snapshot pointer truth

### 5. Email now uses the same canonical message wake contract

Status: landed in this batch

Evidence:

- producer: `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- runtime ingest: `packages/assistant-runtime/src/hosted-runtime/events/email.ts`

Current state:

- Hosted email ingress appends into web-owned `HostedWake`.
- It now appends `conversation.message` wakes directly, matching Linq and
  Telegram ingress.

What to fix:

- Keep the runtime email normalization helper fed from the canonical message
  payload instead of reintroducing a provider-specific top-level wake kind.

## Report deltas to carry forward

These are the key places where the supplied analyses need updating before they
drive implementation:

- “Active-member Linq/Telegram append canonical wakes directly” is already true,
  and the hot path no longer routes through receipt dispatch wrappers.
- “System producers are only partially cut over” is no longer the main gap.
  Activation, channel sync, device-sync, share acceptance, and hosted email all
  already land in `HostedWake`; the real remaining issue is the leftover
  dispatch-era contract surface inside shared runtime code.
- “Cloudflare still owns a second queue architecture” is no longer true for the
  production path. The remaining direct-dispatch seams are test-only.
- “Runtime message turns still go through generic dispatch/event layering”
  remains partly true, but the maintenance coupling is no longer the main gap.
  Message wakes now stay on the conversation lane without forcing the generic
  maintenance loop; the remaining work is to finish deleting the dispatch-era
  envelope and adapter surfaces that still shape those wakes.

## Ordered migration phases

### Phase 1. Keep the shared contract deletion-oriented

Primary files:

- `packages/hosted-execution/src/{contracts,builders,parsers}.ts`
- `apps/web/app/api/internal/hosted-wake/append/route.ts`
- `apps/cloudflare/src/web-control-plane.ts`

Tasks:

- Preserve the wake-first append/control-plane boundary.
- Keep new work off `HostedExecutionDispatchRequest`.
- Delete compatibility-only builders/parsers when tests and internal callers no
  longer need them.

Acceptance:

- No new producer needs `HostedExecutionDispatchRequest` just to append a wake.
- New message wakes no longer use top-level provider-specific kinds.

### Phase 2. Tighten the active-member webhook fast path

Primary files:

- `apps/web/src/lib/hosted-onboarding/{webhook-service,webhook-provider-linq,webhook-provider-telegram}.ts`

Status in this repo: landed for the active-message hot path; remaining receipt
state is local-side-effect-only.

Tasks:

- Keep the active-member direct append-plus-nudge path as the only hot-path
  owner for Linq and Telegram message ingress.
- Keep receipt-managed flows only for invite/quota/local side effects and the
  minimal duplicate-claim semantics still required during the transition.
- Keep best-effort wake nudging derived from the appended wake target.

Acceptance:

- Active-member Linq and Telegram webhook message handling no longer directly
  routes through receipt-managed dispatch wrappers on the hot path.
- Receipt-managed continuation only remains where local side effects still need
  it.

### Phase 3. Preserve the runtime conversation lane

Primary files:

- `packages/assistant-runtime/src/hosted-runtime/{execution,events}.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/**`

Status in this repo: landed.

Tasks:

- Preserve the new `maintenanceRequired` gate so conversation wakes execute only
  the capture/conversation path.
- Keep generic maintenance ownership on explicit system wakes.
- Keep provider-specific modules as message parsing/normalization helpers only.

Acceptance:

- A normal conversation wake does not trigger the generic maintenance sweep.

### Phase 4. Keep Cloudflare as the thin shim

Primary files:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/{runner-queue-store,runner-queue-schema,runner-dispatch-processor,runner-scheduler,types}.ts`

Tasks:

- Keep only lease/run/bundle-cache/alarm state in production code.
- Keep user and event status derived from web-owned wake lifecycle by default.
- Delete the test-only direct-dispatch harness once it is no longer needed.

Acceptance:

- Cloudflare no longer persists queue correctness state that can disagree with
  web-owned wake lifecycle state.

### Phase 5. Keep email and any stragglers on the same final wake contract

Primary files:

- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/email.ts`

Tasks:

- Preserve email on the canonical `conversation.message` wake contract.
- Remove compatibility-only parsing once all producers are moved.

Acceptance:

- Linq, Telegram, and email all enter the runtime through the same top-level
  message wake kind.

### Phase 6. Delete the last compatibility-only surfaces and keep docs honest

Primary files:

- stale hosted-execution builders/parsers/helpers
- stale Cloudflare queue helpers
- durable docs that still describe dispatch-era ownership

Tasks:

- Delete unused dispatch-only builders, parsers, tests, and status helpers.
- Keep durable docs aligned with the production owner boundaries instead of the
  compatibility shims.

Acceptance:

- No canonical hosted runtime doc still describes dispatch envelopes or
  Cloudflare-owned queue truth as the steady-state architecture.

## Remaining delete-only follow-ups

These are the pieces still worth cleaning up if we want to remove every last
dispatch-era compatibility seam:

1. Delete shared hosted-execution compatibility builders/parsers once the last
   internal callers and tests stop needing them.

2. Delete Cloudflare test-only direct-dispatch helpers and the remaining
   dispatch-payload-store coverage once the harnesses move fully onto wake-based
   helpers.

3. Keep shrinking webhook receipt ownership until only explicitly justified
   onboarding/quota/local-side-effect flows remain.

## Exit criteria for the full hard cut

- Web/Postgres is the only owner of hosted wake ordering, lifecycle, cursor
  state, and snapshot pointer truth.
- All producers append canonical wake contracts directly, not
  `HostedExecutionDispatchRequest`.
- Active-member message ingress does not depend on the webhook receipt engine.
- Message wakes do not trigger the generic maintenance loop.
- Cloudflare Durable Objects no longer persist their own queue truth.
- The repo does not treat dispatch-era envelopes as the canonical production
  hosted execution model.
