# Unify group access offers across iMessage and SMS

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Give the assistant one semantic way to offer group access while the trusted
  hosted runtime chooses the presentation supported by the current channel.
- Preserve native iMessage Like-to-consent offers and use existing first-party
  permission links for SMS, Telegram, scheduled delivery, and explicit
  standalone-link requests.

## Success criteria

- Current interactive iMessage routes keep the native consent offer.
- SMS and Telegram routes receive a usable first-party link without exposing
  unsupported iMessage reactions, attachments, or chat customization.
- Scheduled group turns use the existing link path because their durable route
  does not encode the Linq service subtype.
- Ambiguous or mismatched route evidence fails closed.
- SMS sender handles remain available for route-authorized group attribution.
- Focused assistant-engine and assistant-runtime tests and typechecks pass.
- Required product, preliminary specialist, final ReviewGPT, and exact-head CI
  gates complete with no unresolved accepted findings.

## Scope

- In scope: assistant tool schema/parsing, hosted channel adapter, group skills,
  direct regression tests, and live architecture/product documentation.
- Out of scope: database or API changes, new persisted state, new queues or
  services, provider delivery rewrites, and changes to Web-owned group access
  semantics.

## Constraints

- Technical constraints: keep existing `create_join_link` and
  `post_join_offer` wire actions as the Web-owned implementation surface; add
  no compatibility path that makes assistant-engine depend on runtime.
- Product/process constraints: sharing stays explicit, scoped, route-bound,
  and fail-closed; no additional automatic message is introduced; use an
  isolated worktree and the PR completion workflow.

## Risks and mitigations

1. Risk: channel selection could weaken route or consent authority.
   Mitigation: derive presentation only from trusted runtime route context and
   keep all existing Web-side authorization and effect ownership unchanged.
2. Risk: SMS fallback could accidentally expose iMessage-only effects.
   Mitigation: return typed unsupported responses and cover each service branch
   with deterministic tests.
3. Risk: the old embedded patch no longer matches current owner code.
   Mitigation: port behavior manually onto current `main`, inspect the full
   affected call paths, and fix types at the owning boundary rather than
   replaying the stale patch mechanically.

## Tasks

1. Reconstruct the intended behavior from PR #1064 and compare it with current
   owners on `main`.
2. Implement the semantic assistant action and trusted channel adapter using
   existing wire effects.
3. Update group skill guidance, durable owner docs, and focused tests.
4. Run focused verification and direct route-matrix proof.
5. Publish a review candidate, complete the required review/CI gates, close the
   plan through the scoped commit path, and replace PR #1064.

## Decisions

- Keep one model-facing `offer_access` action while retaining the two existing
  internal Web actions. This is an adapter/facade change, not a new service or
  state owner.
- Treat scheduled execution as link presentation until the durable scheduled
  route records a trustworthy Linq service subtype.

## Verification

- Commands to run: focused Vitest files for assistant-engine and
  assistant-runtime, package typechecks, `pnpm docs:drift`, required PR CI,
  preliminary `completion-specialists`, product-experience review, and final
  ReviewGPT.
- Expected outcomes: the route matrix and unsupported-effect matrix pass,
  package types remain sound, durable docs stay indexed, CI is green, and all
  accepted audit findings are resolved.
