# Recap desktop ticket design

## Outcome and invariant

Give the desktop recap handoff one centered composition: cream page, night card,
story bars, and a rotated gold ticket holding the real QR. Preserve the Apple
mobile view, server UA selection, canonical QR target, generic metadata, ID
validation, and no game lookup. Metadata and OG files belong to separate work.

## Ownership and approach

The existing view owns both presentations; its desktop branch gets scoped CSS.
The page body supplies the desktop page spacing. Reuse the encoder and site fonts;
no client state, network service, new dependency, or alternate data owner.

## Product UX and proof

Desktop 1280x800 uses two columns; 800x900 stacks words above the ticket. Also
check a narrow non-Apple phone and the 860px breakpoint for sideways overflow.
Apple mobile keeps its current heading, button and App Store fallback. The QR
must decode from rendered screenshots at its actual rotation and size.

Run focused recap/changelog tests, Web typecheck, lint, and complexity guard.
Inspect and publish synthetic screenshots at both requested desktop viewports.
Use the real route for browser proof and the production component study for PR
review. Follow the ReviewGPT loop on the stable pushed candidate concurrently
with CI, then merge and verify the canonical deployment and both UA responses.

## Delivery boundary

Web presentation only; no schema, native protocol, or rollout ordering change.
The existing app universal-link behavior remains the final recap destination.

## Local evidence

Product UX: Ready. Inspected the real route at 1280x800 and 800x900 in light
mode, the 860px layout boundary, a 320px non-Apple viewport, and the unchanged
390px iPhone view. No sideways overflow; ticket and words remain separate.
Apple Vision decoded both requested desktop screenshots to the canonical
synthetic recap URL at the rendered rotation and size. The browser journey also
passes with JavaScript disabled and rejects an invalid ID with 404.

Focused recap and changelog tests: 57 passed. Browser tests: 2 passed. Web
typecheck, focused lint, diff whitespace check, and complexity guard passed;
no changed function exceeds 20. No new dependencies or metadata/OG edits.
Parent review confirms the Apple branch retains the previous markup and styles.

## Candidate handoff

Implementation and local proof are complete in PR #4434. Synthetic screenshots
are attached to the PR; source preview deployment is
`dpl_3oYL3ydSdCqWgh11kmR97JW2phqF`. Final ReviewGPT, exact-head CI, merge, and
canonical deployment verification remain completion gates owned by this session.
Status: completed
Updated: 2026-11-01
Completed: 2026-11-01
