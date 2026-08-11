# iMessage fallback image parity

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Audit every schema-backed iMessage fallback raster against the production
  SwiftUI card rendered by the sibling Card Studio.
- Make nutrition, compact-table, workout, and challenge fallback images preserve
  the native information hierarchy while carrying the canonical Murph SVG mark
  in the upper-left of the bitmap.
- Keep the existing bounded, identity-free, stateless image route and complete
  semantic caption fallback unchanged.

## Scope

- The shared iMessage image chrome, nutrition, compact-table/workout, and
  challenge-standing renderers and their design-catalog studies.
- Focused route/render tests, simulator reference captures, direct PNG proof,
  and the durable response-card contracts that define logo ownership.
- No changes to card payload schemas, persistence, send ownership, routing, or
  the native extension's data authority.

## Constraints

- Reuse the checked-in canonical SVG mark rather than redrawing brand geometry.
- Treat the bitmap as rectangular content; the provider still owns the outer
  bubble mask and transcript caption chrome.
- Preserve bounded image dimensions, queryless private URLs, complete caption
  semantics, and all schema V1-V5 compatibility.
- Keep production payloads identity-free and avoid adding a service, store,
  dependency, or lifecycle owner.

## Tasks

1. [x] Inventory all native fixtures and Web raster branches, then capture the
   production SwiftUI reference states in Simulator.
2. [x] Record first-principles audit findings and settle one shared logo/header
   contract for every fallback kind.
3. [ ] Implement the smallest shared renderer correction and update all studies.
4. [ ] Add focused structural and real-raster regression coverage.
5. [ ] Capture and inspect corrected fallback images beside native references.
6. [ ] Complete focused verification, review gates, exact-head CI, and PR handoff.

## Verification

- Focused iMessage ImageResponse component/route tests, including real PNG proof.
- Hosted Web typecheck and scoped lint for changed files.
- Documentation drift and diff hygiene.
- Simulator screenshots for every native card family and direct rendered PNGs
  for every fallback family, inspected at native presentation scale.
