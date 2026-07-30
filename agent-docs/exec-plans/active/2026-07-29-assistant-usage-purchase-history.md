# Assistant usage purchase history

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Let Murph answer an explicit private question about usage top-ups with
  beneficiary-scoped purchase-credit history instead of inferring purchase
  state from the aggregate usage percentage.

## Success criteria

- The existing `murph.plan_usage` read accepts an explicit top-up-history
  expansion while preserving the original compact request and response.
- The expansion lists only purchase grants credited to the callback-bound
  member, distinguishes self-funded from Family-funded credit, and exposes no
  member, purchase, ledger, Stripe, or payment identifiers.
- Each bounded row reports the immutable added amount and credited timestamp,
  usage debited from that grant, remaining credit, and any non-usage adjustment.
- An exact total count plus an honest truncation marker prevents the assistant
  from overstating a bounded list as complete.
- Focused contract, assistant, runtime transport, route, projection, typecheck,
  and direct-scenario proof pass with the required product and review gates.

## Scope

- In scope: the shared plan-usage contract, assistant tool arguments and
  guidance, assistant/runtime ports, signed Cloudflare-to-Web callback, the
  Web-owned top-up history projection, focused tests, and owner documentation.
- Out of scope: purchase creation, Stripe flows, usage settlement, allowance
  policy, Settings presentation, proactive notices, schema changes, and
  historical usage-cost attribution outside purchase credits.

## Constraints

- Keep billing and usage-ledger truth in `apps/web`; Cloudflare and the
  assistant transport only the strict member-bound projection.
- Run history reads only for the explicit expansion and keep ordinary
  low-usage reads unchanged.
- Preserve group isolation: synthetic group usage must not expose personal
  top-up history.
- Keep all database reads sequential and bounded, and do not expose private
  identifiers or internal micros fields.
- Preserve older Web/runtime compatibility by making the request and response
  expansion optional.

## Risks and mitigations

1. Risk: a payer's purchase for another Family member is presented as their
   own capacity.
   Mitigation: select immutable `purchase_grant` ledger entries by beneficiary,
   then label source from the bound member's relationship to the payer.
2. Risk: refunds or disputes are mislabeled as usage.
   Mitigation: sum only `usage_debit` child entries for `usedUsd` and project
   non-usage removal separately as `adjustedUsd`.
3. Risk: a bounded list is described as complete.
   Mitigation: return an exact beneficiary-scoped total count and `hasMore`.
4. Risk: the expansion increases every assistant prompt or database read.
   Mitigation: keep it behind one literal optional tool argument used only for
   an explicit top-up-history question.
5. Risk: strict transport rollout rejects the new request or response.
   Mitigation: keep both fields optional, prove legacy shapes, and deploy Web
   before the Cloudflare/runtime caller.

## Tasks

1. Extend the strict shared request and response contract.
2. Thread the explicit expansion through assistant-engine, assistant-runtime,
   Cloudflare, and the signed Web callback.
3. Add the Web-owned bounded beneficiary projection and focused regression
   coverage.
4. Update durable plan-usage, top-up, and Cloudflare ownership documentation.
5. Run focused verification, direct scenario proof, product-experience review,
   preliminary prompt/coverage review, parent final review, exact-head CI, and
   the final ReviewGPT gate.

## Decisions

- Extend `murph.plan_usage` instead of adding a second billing read tool.
- Return decimal USD strings rather than internal micros or floating-point
  numbers.
- Treat the credited ledger timestamp as authoritative and name it
  `creditedAt`; it is not necessarily the payment-attempt creation time.
- Run local `product-experience-review`, the preliminary prompt and coverage
  lenses, and the final ReviewGPT gate because this changes private
  user-visible billing interpretation across the assistant/runtime/Web trust
  boundary.
- The frontend lens is not applicable because this task changes no rendered
  UI.

## Verification

- Focused Vitest slices for hosted-execution, assistant-engine,
  assistant-runtime/Cloudflare transport, and hosted Web status/route
  projection.
- Focused package/app typechecks for every changed owner.
- Direct projection scenario covering a self-funded grant, a Family-funded
  grant, FIFO usage debits, an adjustment, and bounded-history metadata.
- Provider-input measurement for the changed dynamic-tool schema in the
  private personal route.
