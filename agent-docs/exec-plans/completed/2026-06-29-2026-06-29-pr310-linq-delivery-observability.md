# PR 310 Linq runtime delivery observability

Status: completed
Created: 2026-06-29
Updated: 2026-06-29

## Goal

- Fix the PR 310 hosted Linq observability gap where assistant-runtime Linq sends
  reach the provider successfully but never create `hosted_linq_delivery` rows,
  leaving provider delivery receipts uncorrelated and line outbound/delivered
  counters at zero.

## Success criteria

- Hosted assistant-runtime Linq message and voice-memo sends report accepted or
  failed delivery metadata to web without blocking the user-visible send path.
- Web persists accepted runtime sends into the existing `hosted_linq_delivery`
  table using stable idempotency keys and existing line/route authority.
- Provider delivered/failed receipts that lack a line key can project to
  `hosted_linq_line` through the matched delivery row.
- Typing, reactions, and provider webhooks do not invent delivery-attempt rows.
- Focused tests cover runtime callback emission, Cloudflare transport, web route
  persistence, receipt correlation, and typing non-recording.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted Linq send dependencies and effect port
    type.
  - `apps/cloudflare` runtime effects port transport for a narrow Linq delivery
    outcome callback.
  - `apps/web` hosted-runtime internal route and hosted Linq delivery/provider
    event store helpers.
  - Focused tests in touched owners.
- Out of scope:
  - New tables or Prisma migrations.
  - Generic assistant delivery persistence in Cloudflare.
  - Durable queues, schedulers, or retry state machines.
  - Recording typing indicators or reactions as delivery rows.

## Constraints

- Technical constraints:
  - Web remains the owner of hosted product/control-plane observability facts.
  - Cloudflare remains a thin execution adapter and should only forward the
    provider send outcome metadata it observed.
  - Observability writes must be best-effort/off-path and must not add blocking
    latency to reply delivery.
  - Callback payloads must stay metadata-only: no message text, media bytes, raw
    provider payloads, provider headers, secrets, or direct identifiers in logs.
- Product/process constraints:
  - Preserve onboarding, first-contact sends, current inbound replies, and
    typing behavior.
  - Keep the architecture simple and composable; add only the narrow callback
    needed to bridge runtime sends to web-owned diagnostics.

## Risks and mitigations

1. Risk: Web/Cloudflare deploy skew leaves old runtimes without the new callback.
   Mitigation: Make the effect optional/best-effort; old send behavior remains
   functional and only diagnostics degrade until all pieces deploy.
2. Risk: Receipt counters double-increment on duplicate callbacks or webhooks.
   Mitigation: Use existing idempotency/message lookup keys and increment line
   counters only on first accepted/advanced transitions.
3. Risk: The callback accidentally records typing/reactions.
   Mitigation: Wire only the text and voice-memo provider send dependencies and
   add focused negative coverage for typing.

## Tasks

1. Add hosted-execution route constant and assistant-runtime effect-port type
   for Linq delivery outcome recording.
2. Implement Cloudflare effect transport with write-fence headers.
3. Add web internal route and store helper that records runtime delivery outcome
   using existing `hosted_linq_delivery` and line lookup primitives.
4. Make provider-event receipt projection fall back to matched delivery row line
   key and handle receipt-before-delivery catch-up.
5. Add focused runtime, Cloudflare, and web tests.
6. Run focused verification, deep review, resolve findings, and commit through
   `scripts/finish-task`.

## Decisions

- Use a narrow new Linq delivery outcome route instead of overloading
  `linq-egress/engagement`; engagement is pre-send authorization and is also
  used by typing.
- Do not use the generic `writeAssistantDeliveryRecord` port; Cloudflare
  intentionally does not implement it and this bug only needs Linq diagnostics.
- Do not add a durable queue. Missing the callback degrades observability only;
  delivery and provider webhook receipts remain independent.

## Verification

- Commands to run:
  - `pnpm test:diff <touched files>` or equivalent focused owner tests if the
    diff-aware lane is too broad for fast iteration.
  - `pnpm typecheck` unless a credible unrelated blocker appears.
  - Deep review on the final diff.
- Expected outcomes:
  - Focused tests pass and prove accepted delivery persistence plus receipt
    correlation.
  - Typecheck passes.
  - Deep review returns no unresolved accepted findings.
Completed: 2026-06-29
