---
name: product-feedback
description: Use in a private conversation before calling murph.submit_product_feedback, when the member is frustrated with Murph, asks for a feature, shows interest in the changelog or feature catalog, or when a Murph workflow is blocked, degraded, circular or manual.
---

# Product feedback

## What counts

- Capture explicit product frustration or feature requests, changelog or
  feature-catalog interest, clear inferred workflow friction, and repeated
  Murph-observed tool friction.
- A blocked, degraded, or manual Murph workflow is a high-confidence inferred
  feature request even without a complaint. Treat requests, bugs, and
  workarounds as clues to the member's goal, underlying problem and desired
  outcome, not automatically the thing to build. When known, summarize that
  problem and outcome instead of only the requested implementation or symptom.
- Visible dissatisfaction aimed at Murph after repeated, circular, redundant or
  contradictory Murph-owned behavior is explicit product frustration, not just
  tone, banter or missing input. Strong examples: Murph asking again for
  information or consent already given, sending the member through a step that
  cannot produce the promised result, or reversing its own claim about
  available context or capability. Address the immediate need and capture it;
  do not wait for the member to call it feedback, ask permission, or start a
  separate discovery interview.
- Keep that trigger narrow. Do not log generic emotion or teasing unrelated to
  Murph, a clean first request for genuinely missing input, safety refusals, or
  purely external or transient failures unless they expose a Murph-owned gap.

## How to capture

- On explicit feedback submission, record the facts and gaps now. Otherwise, if
  one missing answer would materially change what Murph should build, ask one
  concise natural follow-up and do not call the tool yet. Ask at most one
  discovery question per turn; use prior context and never re-ask. Continue
  only for useful new information. Scheduled audits report evidence and
  coverage limits without questions.
- Do not mention logging or ask permission unless asked about it. Still help
  with the immediate request or the best fallback.
- Capture the single most material gap; at most one candidate may be accepted.
  Ordinary feedback stays silent for every result. Reserved support follows
  Support and skips discovery.
- On the first input-schema rejection, correct only the returned issues and
  retry once. A second rejection is terminal. Accepted, already accepted,
  unavailable and callback-failure results are terminal. Persistence is
  best-effort after the reply.

## Privacy

- Before submitting feedback or support, reduce private context to product
  behavior, for example "connected-source records disappeared after sync". Omit
  diagnoses, health topics, provider payloads, care settings such as clinics,
  and family relationships from both summary and reproduction, even when they
  explain the complaint.
- Use `feature_request` for missing paths. Record only kind, a concise
  product-only summary, and optional changelog ids. For friction, append a
  privacy-safe `Reproduction:` section in that same summary field; follow the
  tool schema for prefixes, privacy and exact contents.
