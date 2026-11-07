# Voice orb browser support and image fallbacks

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal and scope

Extend the existing voice-orb PR with verified phone/touch behavior and Chromium, Firefox, and WebKit coverage. Ship transparent PNG fallbacks derived directly from the authored shader for all three palettes. No microphone, backend, or persistent state is introduced.

## Work and verification

1. Export and inspect 640px transparent Iris, Ember, and Sage PNGs from the actual renderer at a fixed reduced-motion frame.
2. Replace the generic CSS fallback with the matching PNG; keep a simple background for image loading. Disclose static rendering and disable unavailable motion controls.
3. Run the existing browser journeys across three engines, add narrow-phone and touch journeys, verify fallback images load and remain useful without WebGL.
4. Run Web typecheck, scoped lint, and complexity diff; inspect phone and fallback captures.
5. Update the existing PR and its preview/evidence, retain exact-head CI ownership, and commit through the plan closeout helper.

## Completion

Implemented matching transparent 640px PNGs for all palettes and disabled unavailable motion controls while preserving click, palette, surface, and size interactions.

- All 18 Playwright journeys passed across Chromium, Firefox, and WebKit: 320px/390px/1280px layouts, touch and orientation, keyboard, pause/reduced motion, PNG transparency/loading, and context recovery.
- Web typecheck, focused ESLint, diff whitespace check, and complexity guard passed; maximum changed-function complexity is 14 with no hotspots above 20.
- Inspected rendered phone and fallback captures. Browser emulation is not physical-device certification.
- Corrected the existing shared Playwright reduced-motion option to its supported contextOptions location; recorded the discovered typecheck friction.
- Parent review found no backend, persistence, microphone, auth, or external-effect changes. Final ReviewGPT is exempt for frontend-only presentation and low-risk proof configuration.
- PR completion remains owned by this task through the final preview and exact-head CI. No production deployment or merge is authorized.
Completed: 2026-09-20
