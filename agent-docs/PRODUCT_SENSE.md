# Product Sense

Last verified: 2026-04-22

## Current Posture

- Murph is the experiment layer for personal health, not primarily a generic chatbot, dashboard, or vault product.
- The core loop is: choose a protocol, run a bounded experiment, review what changed, then decide whether to share or contribute the result.
- The assistant is the easiest interface into that loop; the compounding layer is the protocol outcome network and living Health Commons.
- Product behavior should help people learn from interventions and from people like them without turning health into status theater.

## First-Class Product Objects

- Public Health Commons pages for protocols, biomarkers, sources, and aggregate outcomes
- Private experiment runs bound to exact protocol revisions
- Completed outcome cards derived from those runs
- Opt-in cohort summaries and protocol-variant learning built from contributed outcomes

## Guardrails

- Compare interventions, not bodies.
- Keep private run data private by default; public sharing is explicit and permissioned.
- Rank learning, replication, confidence, and contribution quality before ranking people.
- Prefer weekly digests, deliberate pull surfaces, and bounded sharing over infinite feeds or compulsive refresh loops.
- Any result that can be shared or aggregated must stay tied to the exact protocol revision, test plan, and confidence language that produced it.
- If a user-visible behavior is still undefined, record it in `agent-docs/product-specs/` before it spreads into copy, UI, or runtime code.
