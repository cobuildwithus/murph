# Browser Vault Murph Age Readiness

## Goal

Expose a browser-safe Murph Age readiness projection from the browser vault for internal research plumbing only, so downstream code can tell which lab, blood-pressure, body, and wearable inputs are present without scoring, promoting, or displaying a biological-age estimate.

## Scope

- Add a `packages/query` browser subpath selector for sanitized Murph Age readiness.
- Keep values, units, point ids, record ids, predictions, model internals, coefficients, and age-like outputs out of the browser-facing readiness result.
- Add focused tests for lab/BP/body readiness, wearable shadow context, wearable-only context, and browser entry exports.

## Non-Goals

- No production Murph Age score display.
- No website route, sidebar item, dashboard card, or user-facing Murph Age readiness surface until a later product authorization plan explicitly unlocks it.
- No model promotion, recommendation claim, protocol claim, or causal/actionability claim.
- No ReviewGPT call for local export/test plumbing.

## Verification

- Focused browser-vault Murph Age readiness tests.
- Browser entry-surface/boundary tests.
- `packages/query` typecheck.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
