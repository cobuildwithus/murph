# Hosted Hard-Cut Migration Guide

Status snapshot: 2026-04-18

## Final state

The hosted cutover is now wake-first end to end.

- Web owns `HostedWake` ordering, payload storage, lifecycle, and
  `HostedExecutionCursor` compare-and-swap state.
- Producers append canonical wakes directly.
- Cloudflare fetches wakes from web, executes them, and commits cursor state
  back to web instead of owning queue truth.
- Conversation wakes stay on the conversation lane without forcing the generic
  maintenance sweep.
- Wake status is canonical `wakeState` end to end.

The repo no longer treats dispatch envelopes, Cloudflare queue tables, or
dispatch-named status surfaces as the production hosted execution model.

## Canonical owner boundaries

### Web / Postgres

Canonical owner of:

- wake ordering
- wake lifecycle state
- quarantine / poison truth
- committed high-water
- snapshot pointer truth
- payload spillover and encrypted wake storage

Primary files:

- `apps/web/src/lib/hosted-wake/store.ts`
- `apps/web/app/api/internal/hosted-wake/{append,commit,quarantine,repair,status,unseen}/route.ts`

### Cloudflare

Runtime shim only:

- fetch unseen wakes from web
- execute wakes
- manage active run / lease state
- commit cursor state back to web
- keep warm bundle/runtime coordination local to the Durable Object

Primary files:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/web-control-plane.ts`

### Assistant runtime

Wake-native execution boundary:

- `conversation.message` executes the conversation lane only
- system wakes own maintenance follow-up explicitly
- post-commit assistant delivery is logged and tracked as delivery work, not as
  dispatch work

Primary files:

- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`

## Canonical wake contract

The production hosted path should only treat these wake kinds as canonical:

- `conversation.message`
- `member.activated`
- `member.channels.updated`
- `vault.share.accepted`
- `device-sync.wake`
- `assistant.cron.tick`

Top-level wake kinds model execution lanes and wake behavior, not transport
brands.

Inbound conversation traffic uses one canonical persisted message wake kind:
`conversation.message`.

Channel-specific detail for Linq, Telegram, and email belongs inside the
`conversation.message` payload via `message.channel`, not in top-level
provider-specific wake kinds.

Provider-specific normalization happens at ingress and runtime edges. The
canonical queue contract should stay transport-agnostic as long as email, Linq,
and Telegram all share the same ordering, session-binding, retry, and
quarantine semantics on the conversation lane.

## Producer status

These producers already append canonical wakes directly:

- active-member Linq webhook
- active-member Telegram webhook
- hosted email ingress
- member activation
- member channel sync
- device-sync signals
- share acceptance

Active-member message ingress no longer depends on receipt-managed dispatch
wrappers on the hot path. Receipt state only remains where web still owns local
invite/quota side effects outside the hosted runtime wake lane.

## Runtime status

The runtime hard cut is landed:

- `executeHostedWakeEvent(...)` is the wake-native entrypoint
- conversation wakes do not force `runHostedMaintenanceLoop(...)`
- system wakes keep explicit maintenance ownership
- wake summaries and wake logs are wake-native

Provider-specific helpers that remain in the conversation lane are now just
message normalization helpers from canonical wake payloads into inbox runtime
captures. They are no longer a dispatch-era ownership seam.

## Cloudflare status

The production Durable Object is a thin runner:

- no production `dispatch` / `dispatchWithOutcome` RPC surface
- no `pending_events`, `consumed_events`, `backpressured_events`, or
  `poisoned_events` queue-truth tables
- no staged dispatch-payload control plane in the live hosted path
- canonical status reads come from web-owned wake state

Any remaining local helper residue should stay test-only and should not be used
to infer production ownership.

## Exit criteria

This repo now satisfies the intended hard-cut criteria:

- Web/Postgres is the only owner of hosted wake ordering, lifecycle, cursor
  state, and snapshot pointer truth.
- Producers append canonical wake contracts directly.
- Active-member message ingress does not route through receipt-managed dispatch
  wrappers.
- Conversation wakes do not trigger the generic maintenance loop.
- Cloudflare Durable Objects no longer persist their own queue truth.
- The repo does not treat dispatch-era envelopes as the canonical production
  hosted execution model.
