# Telegram Ingress Latency Trace

Status: completed
Created: 2026-06-29
Updated: 2026-06-29

## Goal

- Extend the existing hosted ingress latency trace to Telegram webhook wakes.

## Success criteria

- Telegram accepted/signal/staged/provider-start trace events use the existing trace table and callback contract.
- Linq behavior is unchanged.
- WhatsApp remains unclaimed unless explicitly added later.

## Scope

- In scope: latency source contract, webhook post-response trace scheduling, runtime staged/provider-start trace emitters, focused tests.
- Out of scope: new storage, queues, scheduler ownership, dashboard redesign, delivery behavior changes.

## Constraints

- Observability remains best-effort and off the awaited webhook/reply path.
- Trace metadata must not include message bodies, raw provider payloads, secrets, or direct contact identifiers.
- Preserve existing architecture; carry the provider source through existing primitives.

## Risks and mitigations

1. Risk: claiming unsupported channels in the source enum.
   Mitigation: add Telegram only, keep WhatsApp filtered out.

## Tasks

1. Add Telegram to the supported hosted ingress latency sources.
2. Pass the narrowed source through webhook trace writes.
3. Pass the narrowed source through staged/provider-start runtime callbacks.
4. Add focused regression tests and run verification.

## Decisions

- Use the existing `HostedIngressLatencySource` union rather than adding a Telegram-specific path.

## Verification

- Focused web handoff test.
- Focused assistant runtime mailbox import and maintenance tests.
- Workspace typecheck.
Completed: 2026-06-29
