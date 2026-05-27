# Linq typing container prewarm

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Prewarm cold Cloudflare runner containers when an active iMessage Linq user starts typing, reducing message latency without treating typing as durable assistant work.

## Success criteria

- `chat.typing_indicator.started` can signal the existing per-user Temporal runtime workflow for active hosted Linq routes.
- The prewarm path uses a dedicated signal kind, Temporal activity, and Cloudflare `/runtime/prewarm` route.
- Typing prewarm never appends mailbox, never starts mailbox demand, never starts an assistant run, never begins a runtime write fence, and never consumes usage.
- A later `message.received` path remains unchanged and wins over any pending or in-flight prewarm; mailbox demand must never wait for a prewarm HTTP/activity result.
- Focused tests prove mailbox-send and prewarm cannot conflict.

## Scope

- In scope:
  - Linq typing event parsing.
  - Active-route-only web prewarm handoff with coarse coalescing.
  - Hosted execution signal/prewarm contracts and parsers.
  - Temporal workflow prewarm state/activity orchestration.
  - Cloudflare signed prewarm route and runner/container shell warmup.
  - Focused unit tests for no mailbox/run conflicts.
- Out of scope:
  - New onboarding behavior from typing.
  - Typing stopped handling.
  - Assistant runtime or mailbox demand changes for typing.
  - User-facing UI.

## Constraints

- Technical constraints:
  - Preserve the existing `runtimeSignal` Temporal signal name.
  - Do not add typing to hosted runtime demand run sources.
  - Do not call Cloudflare directly from webhook ingress.
  - Do not store raw chat ids, phone numbers, message content, provider payloads, or headers in Temporal state or logs.
  - Add Temporal replay compatibility gating for any new command-producing workflow path.
- Product/process constraints:
  - Clean, simple, composable architecture is the priority.
  - Preserve unrelated dirty work in overlapping Temporal and Cloudflare files.

## Risks and mitigations

1. Risk: typing prewarm races with a later iMessage mailbox send.
   Mitigation: prewarm is side-effect-limited to container readiness, uses no write fence, and the workflow must not await prewarm completion before processing a later mailbox/demand signal.
2. Risk: repeated typing events create noise or cost.
   Mitigation: web coalesces before Temporal and Temporal collapses repeated signals into one pending flag.
3. Risk: deploy skew between Temporal and Cloudflare.
   Mitigation: prewarm activity treats route rejection as retry-later/failed best-effort and clears stale hints.

## Tasks

1. Add Linq typing parse support and web signal helper.
2. Add hosted execution prewarm signal/request/response contracts.
3. Add Temporal activity and workflow prewarm handling.
4. Add Cloudflare prewarm route/runner/container method.
5. Add focused tests and run required verification.

## Decisions

- Use the existing per-user Temporal workflow with a new `runtime_prewarm_requested` signal kind, but keep the prewarm execution path non-blocking relative to later demand signals.
- Keep typing outside mailbox and `readRuntimeDemand`.
- Cloudflare prewarm route may only warm or observe the container shell; it must not call `ensureRuntimeProcessingForUser`.

## Verification

- Commands to run:
  - Focused tests for `messaging-ingress`, hosted execution contracts, hosted Linq webhook, Temporal workflow/activity, and Cloudflare route/runner.
  - `pnpm typecheck`.
  - Broader diff/app verification as practical after inspecting overlap.
- Expected outcomes:
  - Tests prove typing prewarm does not append mailbox, send read receipts, bind routes, start ensure-processing, or block a later mailbox send while prewarm is pending/in flight.
Completed: 2026-05-27
