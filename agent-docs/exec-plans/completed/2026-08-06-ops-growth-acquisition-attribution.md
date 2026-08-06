# Show durable acquisition sources on the ops growth dashboard

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make the ops growth dashboard distinguish proven direct-iMessage trial
  activations from authenticated web and companion starts, without inferring
  historical provenance from mutable identity state or exposing full contact
  identifiers.

## Success criteria

- Every new Pulse trial persists one immutable, server-selected start source at
  the existing billing owner.
- The growth dashboard shows source totals and a recent-start ledger with only
  privacy-safe identity hints, while legacy rows remain explicitly unknown.
- The existing raw member-creation count is relabeled so operators do not read
  it as completed signup attribution.
- Focused service, metrics, rendering, and migration proof passes; the real
  production section appears in the design catalog at desktop and mobile
  widths.
- Required preliminary specialist ReviewGPT, final ReviewGPT, exact-head CI,
  parent review, plan closure, scoped commit, and PR gates complete.

## Scope

- In scope: additive hosted billing attribution, direct-iMessage/web/companion
  auto-trial callers, the card-based website trial fallback, growth metrics and
  ops UI, privacy-safe recent-start display, focused tests, design study, and
  owner documentation.
- Out of scope: heuristic backfills, marketing analytics vendors, changing
  trial eligibility or entitlement, changing instant-start ordering, or showing
  full phone numbers or email addresses.

## Constraints

- Technical constraints: attribution is descriptive only and never authority;
  legacy rows stay nullable/unknown; timestamp interpretation remains UTC; no
  new queue, event stream, analytics service, or runtime state owner.
- Product/process constraints: preserve the existing ops chart hierarchy and
  warm flat visual system; use the real production component in the design
  catalog; follow the high-risk schema/billing PR lane and privacy review gates.

## Risks and mitigations

1. Risk: current phone/Privy state changes after signup and would corrupt a
   derived attribution label.
   Mitigation: persist the source exactly once with the successful trial billing
   write and never recompute it from current identities.
2. Risk: an ops ledger could disclose unnecessary personal data.
   Mitigation: return only an existing masked phone hint or a neutral absent
   state and never decrypt or render a full contact identifier.
3. Risk: adding attribution changes the payment/activation critical path.
   Mitigation: keep it in the existing transaction and column write, with no
   extra database or provider call and no entitlement decision based on it.
4. Risk: deploy skew causes old writers to omit the new field.
   Mitigation: use a nullable additive column and render null as legacy/unknown.
5. Risk: card-based website trial fallback bypasses auto-enrollment attribution.
   Mitigation: put the server-selected website source in existing Checkout and
   subscription metadata, then persist the canonical subscription value in the
   accepted redemption write; standard paid Checkout remains source-free.

## Tasks

1. Prove the exact billing write and all trial-start caller surfaces, then select
   the smallest source vocabulary and immutable owner.
2. Add the additive schema migration and thread the server-selected source
   through direct iMessage, authenticated web (auto and card fallback), and
   companion trial starts.
3. Extend growth metrics with source totals and privacy-safe recent records;
   relabel raw member records precisely.
4. Render the production section in the ops page and design catalog with focused
   unit/rendering coverage and desktop/mobile browser proof. Completed with
   synthetic, masked catalog data at 1440px and 390px viewports.
5. Run scoped verification, push the exact candidate, complete ReviewGPT and CI,
   resolve findings, close the plan, and hand off the PR.

## Decisions

- Persist trial-start attribution beside `pulseTrialRedeemedAt`; it describes
  the event the dashboard needs and every direct iMessage instant start already
  owns that event.
- Keep historical nulls explicit. Current identities are not trustworthy
  historical provenance.
- Treat attribution as descriptive metadata only; entitlement and activation
  continue to use their current canonical inputs.

## Verification

- Commands to run: focused Vitest suites for auto-trial enrollment, card
  Checkout creation/completion, growth metrics, and ops rendering; Prisma
  schema/migration checks; `apps/web` typecheck; focused growth Playwright proof;
  design catalog browser screenshots; `git diff --check`; exact-head required
  CI; preliminary specialist and final ReviewGPT passes.
- Expected outcomes: all new sources persist exactly once, unknown legacy data
  remains visible without guesswork, UI is readable and responsive, no full
  identifiers enter output/artifacts, and all required gates are green.

## Completion evidence

- Focused ESLint, Prisma validation, prepared web typecheck, migration guards,
  and 290 focused Vitest tests passed.
- The focused growth Playwright gate passed at 1440px and 390px, including
  accessible chart names, keyboard focus, forced-colors behavior, and viewport
  containment. Ten synthetic design-catalog captures cover every renamed
  surface plus populated and empty attribution states at desktop and mobile.
- The preliminary completion-specialists gate passed with no product,
  frontend, prompt, or coverage findings after its evidence packet was made
  exact-head consistent. Final ReviewGPT round 2 passed with no findings after
  verifying both accepted round-1 corrections.
- The parent final review found no remaining correctness, privacy, UX,
  architecture, or proof gap. Required GitHub Actions will evaluate the
  plan-closure head before handoff.
Completed: 2026-08-06
