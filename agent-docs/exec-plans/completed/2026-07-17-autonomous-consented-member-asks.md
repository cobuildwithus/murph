# Autonomous Consented Member Asks

Date: 2026-07-17
Status: completed
PR: #750
Base reviewed head: `060aadaa3124291162f1a8f97f54efde6d653ada`

## Goal

Allow a group Murph to use an exact active member disclosure grant from either
an accepted group input or an existing scheduled group automation, without
creating another scheduler, queue, workflow, policy engine, or delivery system.

## Decisions

1. **Consent is standing product truth.** The immutable permission and current
   membership-bound grant remain in Web/Postgres and are revalidated before the
   personal candidate and before completion append.
2. **Invocation supplies causality, not consent.** A trusted invocation is
   either an accepted group input or a claimed canonical automation occurrence.
   The model cannot provide either form.
3. **Request identity is per grant per invocation.** Exact retry is idempotent;
   changing the question conflicts; another grant in the same occurrence and
   the same grant in a later occurrence are independent.
4. **Delivery is derived from the trusted origin, not a stored field.**
   Accepted-input requests retain reviewed exact group-conversation delivery;
   scheduled automation-occurrence requests produce an internal completion
   only. Delivery mode is a strict function of `origin.kind`
   (`accepted_input` -> reviewed exact, `automation_occurrence` -> internal),
   so no redundant `deliveryMode` field is carried on the wire or validated in
   lockstep; the internal completion is additionally the only shape that
   carries the disclosed permission text.
5. **Internal completion is an isolated exact-skip turn.** It has the group
   read/ask capability and workspace write access, but no delivery route,
   outbox, notification, connected app, phone call, newsletter, or unrelated
   group mutation capability. It persists only minimum bounded coordinator
   state and returns an exact no-delivery decision.
6. **Newsletter authority remains narrower.** Generic occurrence identity is
   injected for every scheduled canonical automation, while newsletter
   prepare/send authority retains its existing slug and opt-out-window checks.

## Existing owners reused

- canonical group-runtime automation schedule and occurrence claim;
- Assistant Ask encrypted request/completion mailboxes and retry lifetime;
- read-only personal candidate and isolated outgoing reviewer;
- Web/Postgres disclosure grant, membership, runtime, and route authority;
- hosted tool context and existing group callback;
- notification engine's isolated exact-skip execution seam.

## Verification coverage

- new and rollout-compatible request/completion parser shapes;
- mode/origin mismatch rejection;
- accepted-input adapter injection;
- scheduled-occurrence adapter injection;
- scheduled group action allowlist;
- one request per grant per invocation under concurrency;
- changed-question conflict and later-occurrence reuse;
- internal completion contains permission context and never uses the provider
  delivery authority path;
- runtime internal completion performs no origin route/session lookup and
  constructs no delivery identity.
