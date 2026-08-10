# iMessage static nutrition preview

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Keep the shipping Messages extension as the live nutrition-card renderer for
  installed iPhones while giving macOS and iPhones without the extension a
  legible generated image instead of an overloaded caption grid.
- Preserve the existing App Store affordance, one-send outbox ownership, and
  immutable offline card snapshot.

## Scope

- A bounded Vercel `ImageResponse` route for daily nutrition V1 and V2 only.
- The Linq static layout's `image_url` plus one-column semantic captions beneath
  the image for totals, partial state, and V2 goals.
- A reusable nutrition image component and synthetic design-catalog study.
- Focused route, rendering, provider-request, hosted-egress, asset-trace, and
  rollout documentation.

## Constraints

- The route receives the same bounded Base64URL presentation envelope already
  sent to Linq. Encoding is not encryption, so the payload must contain no
  member identity, canonical record reference, credential, or authority.
- The route is GET-only, rejects query parameters and non-nutrition envelopes,
  reads no database or remote service, emits no application log, and returns
  `private, no-store` plus `noindex` headers.
- Add no database, object store, cleanup lifecycle, dependency, queue, retry
  owner, or second message.
- Keep every Linq URL below the provider's existing 2,048-character ceiling.

## Risks and mitigations

1. Risk: Vercel receives the path payload, unlike the fragment-only native URL.
   Mitigation: retain only the existing immutable presentation values, keep all
   identity and authority out, avoid application logging and analytics, and
   make the response private and non-indexable.
2. Risk: Linq fetches the image before the Web route is deployed.
   Mitigation: deploy the compatible iOS reader first, then Vercel Web, then the
   Cloudflare/runtime producer that begins sending `image_url`.
3. Risk: a failed image render could block a card send.
   Mitigation: strict bounded parsing, bundled-asset trace checks, focused
   production-route rendering proof, and physical Mac/iPhone verification
   before rollout completion.
4. Risk: a wide OG composition makes support and goal text unreadable at phone
   balloon width, while raster content has no Linq alt-text field.
   Mitigation: use a square two-row ledger with larger semantic type and repeat
   the complete available snapshot in Linq's supported native caption fields.

## Tasks

1. [x] Define the bounded image URL and static-layout contract.
2. [x] Implement the Vercel image route and production image component.
3. [x] Add catalog, route, provider, egress, and asset-trace proof.
4. [x] Update security, reliability, architecture, UX, and deploy guidance.
5. [x] Push the stacked PR candidate and complete ReviewGPT plus exact-head CI.
6. [ ] Capture one macOS static card and one no-app iPhone static card, then
   close the plan.

## Existing App Store contract

- Linq app identity already includes App Store ID `6786145859`, and the exact
  provider-request test pins it. This change preserves that field; no second
  app identity or download link is added.
