# Product Sense

Last verified: 2026-03-12

## Current Posture

- Product/domain behavior is not defined yet.
- Do not infer requirements from the repository name alone.
- Treat user-visible semantics as undefined until documented in `agent-docs/product-specs/`.

## Guardrails

- Prefer explicit behavior contracts over implied heuristics.
- Name states and outcomes in user-facing terms, not implementation shortcuts.
- Record any irreversible or externally visible behavior in product specs before it spreads across modules.
- Keep the first implementation simple enough that docs, tests, and ownership boundaries stay aligned.
