# Frontend

## Scope

This doc governs UI work in `packages/local-web/**`.

## Surface Posture

- `packages/local-web` is an operator-facing local observability surface by default.
- Treat it as product UI, not a marketing page, unless the user explicitly asks for a branded/expressive redesign.
- The current goals are clarity, scanability, read-only trustworthiness, and obvious next actions.

## Composition Rules

- Start with the working surface itself: current state, recent changes, alerts, or actions.
- Use section titles that tell the operator what the area is or what they can do there.
- Prefer layout hierarchy over card mosaics; a card is only justified when it meaningfully groups interaction or status.
- Keep copy short and literal. If a sentence sounds like homepage copy or design commentary, rewrite it.
- Motion should be restrained and should only help hierarchy or affordance.

## Visual Rules

- Use the existing theme tokens and typography defined in `packages/local-web/app/globals.css`.
- Preserve the established Tailwind-only styling approach for `packages/local-web`.
- Prefer calm surfaces, one accent family, and minimal chrome.
- Avoid decorative hero sections, floating badges, and dense promo-like UI unless explicitly requested.

## Browser Verification

- For UI-affecting `packages/local-web` changes, inspect the rendered route in a browser before handoff.
- Check at least one desktop width and one mobile width.
- Verify there is no horizontal overflow, clipped controls, broken wrapping, or fixed-element overlap.
- When controls open dialogs, drawers, or other temporary states, inspect those states too.

## Docs To Update

Update these docs when frontend behavior or expectations materially change:

- `agent-docs/PRODUCT_SENSE.md`
- `agent-docs/operations/verification-and-runtime.md`
- `packages/local-web/README.md`
