# Homepage handoff for shared iMessage cards

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Give people who open a shared Murph card URL outside Messages a clear, polished path to the iPhone app instead of leaving them on an unexplained homepage.

## Success criteria

- Loading the public homepage with a non-empty `#murph-card=` fragment opens an accessible handoff dialog with the canonical App Store destination.
- The browser never decodes, stores, logs, or transmits the card fragment, and the ordinary homepage is unchanged for every other URL.
- The production component is represented in the design catalog with inert synthetic content.
- Focused tests, web typecheck, frontend design proof, responsive browser proof, and the required frontend completion reviews pass.

## Scope

- In scope: a client-only homepage fragment gate, a reusable shared-card handoff dialog, design-catalog coverage, focused regression tests, and the matching durable product documentation and changelog entry.
- Out of scope: changing the Linq response-card payload, restoring `app_store_id`, decoding the card payload on the web, universal links, associated domains, app routing, or Messages-extension behavior.

## Constraints

- Detect only the exact fragment prefix with a non-empty value; keep the encoded value opaque.
- Use the existing Dialog and Button primitives and the existing Murph visual language; add no dependency or new state owner.
- Render closed on the server and discover the fragment after hydration so server rendering remains deterministic.
- Keep the handoff dismissible, keyboard accessible, responsive, and usable without relying on the card contents.

## Risks and mitigations

1. Risk: reading the fragment during server rendering could cause hydration drift.
   Mitigation: render the gate closed and inspect `window.location.hash` in a client effect.
2. Risk: card contents could leak into analytics, logs, storage, or network requests.
   Mitigation: compare only the fragment prefix and non-empty suffix; never decode, copy, persist, or interpolate the value.
3. Risk: a one-off homepage overlay could drift from the design catalog.
   Mitigation: render the same handoff panel in production and in an inert synthetic design study.
4. Risk: the fallback could interfere with installed-app response-card behavior.
   Mitigation: leave the Linq payload and Messages extension untouched; the web dialog only runs after the browser has already loaded the homepage.

## Tasks

1. Implement the shared handoff panel, controlled dialog, and client-only homepage fragment gate.
2. Add the real component to the design catalog and document the fallback contract.
3. Add focused client regressions for initial fragments, ordinary hashes, dismissal, and later hash changes.
4. Run focused tests, web typecheck, frontend design proof, and responsive browser proof.
5. Complete the required UI double-check and preliminary ReviewGPT lenses, then commit, open the PR, and verify CI.

## Decisions

- Keep `app_store_id` omitted because the provider's native install treatment conflicts with the intentionally edge-to-edge static card preview.
- Use the canonical App Store page as the single primary action and a quiet dismiss action as the recovery path.
- Leave the fragment in the address bar on dismissal; removing it would mutate the shared URL without improving the current session and would make browser navigation surprising.
- Keep one explicit dismiss control in the dialog body. The preliminary specialist review found that the shared Dialog primitive also supplied its default close button, so the production instance disables that duplicate while retaining Escape and backdrop dismissal.
- Bind the fragment-confidentiality claim at both owners: a focused telemetry regression proves URL canonicalization, and a production-faithful Playwright journey proves the synthetic fragment never reaches rendered content or observed request URLs, headers, or bodies.

## Verification

- Focused Vitest dialog and telemetry regressions: 14 tests passed after preliminary-review remediation.
- Scoped ESLint for the remediated component, unit tests, telemetry test, and Playwright journey: passed.
- Production-faithful Playwright journey at 1440×1000 and 390×844: passed; verified accessible dialog naming, focus containment, exactly two visible actions with one dismiss button, Escape and explicit dismissal, fragment preservation, ordinary-hash silence, no horizontal overflow, and no synthetic fragment in rendered content or observed requests.
- Preliminary `completion-specialists` ReviewGPT pass on pushed head `17b22ffb0c4e88dc163a17a2e5e34239a823f868`: complete with product-experience, frontend-proof, and coverage findings; the code and coverage findings are remediated locally, and refreshed production captures remain to be uploaded.
- Claude Code UI double-check: attempted with Fable and blocked by explicit usage-credit exhaustion, which the completion workflow treats as a non-blocking gap.
- Full focused suite, typecheck, design-proof gate, refreshed screenshots, exact-head PR checks, and final parent review: pending.
