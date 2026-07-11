# Product Sense

Last verified: 2026-07-10

## Current Posture

- Murph is the experiment layer for personal health, not primarily a generic chatbot, dashboard, or vault product.
- The core loop is: choose a protocol, run a bounded experiment, review what changed, then decide what to do next. Sharing and contribution are future consent-bound extensions, not current default behavior.
- The assistant is the easiest interface into that loop; the compounding layer is the protocol outcome network and living Health Commons.
- Hosted landing-page signup should hand users directly toward messaging Murph. Signup-oriented accessible-stage landing auth routes to `/home?initialVisit=true`, where `/home` opens a one-shot welcome dialog with a primary Murph contact CTA and a secondary exploration path. Login-oriented landing CTAs continue to route to ordinary `/home`.
- The public changelog is a bounded archive, one dated edition per URL-addressable page. API and digest links to an older item resolve to the exact page and anchor that contains it.
- Product behavior should help people learn from interventions and from people like them without turning health into status theater.

## Conversation-First Control

- Conversation is Murph's primary day-to-day control surface. At least 80% of
  active member-initiated configuration, query, and task-completion outcomes
  should be completable through supported messaging without opening the web
  app; 90% is the design goal.
- Measure discrete user outcomes, not routes, controls, API operations, option
  values, or UI variants. Coverage is conversation-complete outcomes divided by
  all in-scope outcomes, including documented exceptions and known gaps.
  Presentation-only variants, passive system behavior, and internal or operator
  controls are outside the denominator.
- An exception applies only to the irreducible step that inherently requires a
  browser- or operating-system-owned interaction, fresh authentication,
  explicit legal or privacy consent, provider-hosted authorization or payment
  confirmation, or a high-bandwidth visual or file interface whose chat
  equivalent would be unsafe or materially unusable. Do not exempt the rest of
  the workflow. When safe, conversation still handles discovery, setup, the
  smallest authorized handoff, and status or confirmation afterward.

## First-Class Product Objects

- Public Health Commons pages for protocols, biomarkers, and sources, with aggregate outcomes as a future contribution-backed layer
- Private experiment runs bound to exact protocol revisions
- Completed outcome cards derived from those runs
- Future opt-in cohort summaries and protocol-variant learning built from contributed outcomes

## Guardrails

- Compare interventions, not bodies.
- Keep private run data private by default; public sharing is explicit and permissioned.
- Rank learning, replication, confidence, and contribution quality before ranking people.
- Prefer weekly digests, deliberate pull surfaces, and bounded sharing over infinite feeds or compulsive refresh loops.
- Any result that can be shared or aggregated must stay tied to the exact protocol revision, test plan, and confidence language that produced it.
- If a user-visible behavior is still undefined, record it in `agent-docs/product-specs/` before it spreads into copy, UI, or runtime code.
