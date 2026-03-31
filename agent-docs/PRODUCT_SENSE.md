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

## Current Web Surface

- `packages/local-web` is currently an operator-facing local observability UI, not a marketing site.
- Default to utility copy, current-state visibility, recent activity, and obvious next actions.
- Prefer a compass-first read of the week: what changed, what stayed steady, what likely explains the shift, and what is probably not worth reacting to yet.
- Prefer calm hierarchy and scannable sections over decorative density.
- Avoid aspirational hero copy, campaign-style messaging, and ornamental UI devices unless the user explicitly asks for a more branded surface.
