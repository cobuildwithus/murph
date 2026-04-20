# Hosted Hard-Cut Migration Guide

Status snapshot: 2026-04-18

## Final state

This migration guide is historical context only.
The current hosted source of truth is the run-centric protocol in
`agent-docs/references/hosted-run-protocol.md`.
Live docs/process artifacts should frame the system in hosted-run and
hosted-ingress terms; any remaining `hosted-wake` names are grandfathered path
or test residue only until the final naming cleanup lands.

The hosted cutover is now run-centric end to end.

- Web owns external ingress ordering, `HostedRun` recovery state, and
  `HostedExecutionCursor` compare-and-swap state.
- Producers append canonical ingress events directly.
- Cloudflare acquires hosted runs from web, executes `runDrain`, commits the
  prepared snapshot, and finalizes side effects only through the web-owned run
  ledger.
- `conversation.message` stays on the conversation lane without forcing the
  generic maintenance sweep.
- Runtime timers surface as `nextRuntimeWakeAt` / `runtime_timer`, not as
  persisted timer ingress.

The repo no longer treats dispatch envelopes, Cloudflare queue tables, or
dispatch-named status surfaces as the production hosted execution model.

## Canonical owner boundaries

### Web / Postgres

Canonical owner of:

- external ingress ordering
- hosted-run lifecycle and recovery state
- committed high-water
- snapshot pointer truth
- payload spillover and encrypted ingress storage

Primary files:

- `apps/web/src/lib/hosted-run/store.ts`
- `apps/web/src/lib/hosted-ingress/queue.ts`
- `apps/web/app/api/internal/hosted-run/{acquire,commit,finalize,log,status}/route.ts`

### Cloudflare

Runtime shim only:

- acquire hosted runs from web
- execute `runDrain`
- manage active run / lease state
- commit cursor state back to web
- finalize side effects only after the run is reclaimed as `finalizing`
- keep warm bundle/runtime coordination local to the Durable Object

Primary files:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/web-control-plane.ts`

### Assistant runtime

Run-drain execution boundary:

- `conversation.message` executes the conversation lane only
- system follow-up stays explicit inside runtime state
- post-commit assistant delivery is logged and tracked as delivery work, not as
  dispatch work

Primary files:

- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`

## Canonical hosted contract

The production hosted path should treat these ingress kinds as canonical:

- `conversation.message`
- `member.activated`
- `member.channels.updated`
- `vault.share.accepted`
- `device-sync.wake`

No timer-shaped ingress kind remains in the live hosted contract.
Runtime timers use `nextRuntimeWakeAt` and zero-event `runtime_timer` runs, and
any future explicit external/manual/admin trigger must use a separate ingress
kind instead of reviving timer ingress.

Top-level ingress kinds model product/control-plane events, not transport
brands.

Hosted ingress behavior classes in the hard-cut shape are:

- `ordered`
- `coalescing`

The old `edge_triggered` / `parser.drain` follow-up seam is not part of the
shipped hosted contract. Hosted parser work remains inline on
`conversation.message` ingestion rather than materializing a separate hosted
drain wake.

Inbound conversation traffic uses one canonical persisted message ingress kind:
`conversation.message`.

Channel-specific detail for Linq, Telegram, and email belongs inside the
`conversation.message` payload via `message.channel`, not in top-level
provider-specific ingress kinds.

Provider-specific normalization happens at ingress and runtime edges. The
canonical ingress contract should stay transport-agnostic as long as email,
Linq, and Telegram all share the same ordering, session-binding, retry, and
quarantine semantics on the conversation lane.

## Producer status

These producers already append canonical ingress events directly:

- active-member Linq webhook
- active-member Telegram webhook
- hosted email ingress
- member activation
- member channel sync
- device-sync signals
- share acceptance

Active-member message ingress no longer depends on receipt-managed dispatch
wrappers on the hot path. Receipt state only remains where web still owns local
invite/quota side effects outside the hosted runtime run lane.

## Runtime status

The runtime hard cut is landed:

- hosted execution enters through `runDrain`
- conversation ingress does not force the generic maintenance loop
- system follow-up keeps explicit runtime ownership
- run summaries and run logs are run-centric
- parser follow-up remains inline on `conversation.message`; there is no hosted
  `parser.drain` ingress lane

Provider-specific helpers that remain in the conversation lane are now just
message normalization helpers from canonical ingress payloads into inbox runtime
captures. They are no longer a dispatch-era ownership seam.

## Cloudflare status

The production Durable Object is a thin runner:

- no production `dispatch` / `dispatchWithOutcome` RPC surface
- no legacy queue-truth tables such as `pending_events`,
  `consumed_events`, or `backpressured_events`
- no staged dispatch-payload control plane in the live hosted path
- canonical status reads come from web-owned run/cursor state

Any remaining local helper residue should stay test-only and should not be used
to infer production ownership.

## Exit criteria

This repo now satisfies the intended hard-cut criteria:

- Web/Postgres is the only owner of external ingress ordering, hosted-run
  lifecycle/recovery state, cursor state, and snapshot pointer truth.
- Producers append canonical ingress contracts directly.
- Active-member message ingress does not route through receipt-managed dispatch
  wrappers.
- Conversation ingress does not trigger the generic maintenance loop.
- Cloudflare Durable Objects no longer persist their own queue truth.
- The repo does not treat dispatch-era envelopes as the canonical production
  hosted execution model.
