# Clubs marketing page

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Ship a simple, premium `/clubs` early-access page that makes Murph's club-challenge concept tangible before the first organizer pitch.

## Success criteria

- The page leads with one clear promise: organizers run the club while Murph handles the challenge.
- The existing `PhoneMock` shows an illustrative organizer conversation with useful server-rendered and reduced-motion states.
- Visitors can understand collective, team, and individual formats; enrollment, organizer, member, and privacy value; and how to plan a pilot.
- Navigation, footer, homepage, metadata, Open Graph, responsive coverage, and the design catalog all point to `/clubs`.
- Focused tests, canonical diff verification, responsive browser proof, required frontend reviews, CI, and mergeability pass.

## Scope

- In scope: public `/clubs` route and metadata; synthetic marketing components; clubs contact helper; navigation/footer/homepage links; design-catalog study; focused and viewport regressions.
- Out of scope: club runtime behavior, challenge persistence, enrollment mutations, permissions, broadcasts, pricing, self-service launch, and production claims beyond the early-access pilot.

## Constraints

- Reuse the existing standalone marketing system, `PhoneMock`, sticky navigation, footer, and design catalog.
- Treat the supplied patch as intent, correct its singular route, and remove unsupported or visually inconsistent details rather than preserving them mechanically.
- Keep motion optional, server rendering useful, data synthetic, and interactive catalog controls inert.
- Do not use external club branding, photography, testimonials, or unverified scale claims.

## Risks and mitigations

1. Risk: concept copy could imply a shipped self-service product.
   Mitigation: label the experience as illustrative early access and use a pilot-planning CTA.
2. Risk: animation could hide content before hydration or ignore reduced motion.
   Mitigation: render a complete initial state and keep a deterministic reduced-motion state.
3. Risk: a visually dense page could dilute the central promise.
   Mitigation: use one hero artifact, one morphing format demonstration, and restrained supporting sections.
4. Risk: the supplied `/club` route could leave inconsistent links and metadata.
   Mitigation: route, canonical URL, social image, tests, navigation, and viewport coverage all use `/clubs`.

## Tasks

1. Apply and audit the supplied patch against current `main`.
2. Correct the route and polish the page against Murph's current product and design system.
3. Add the real composed page study to `/design?tab=sections`.
4. Add focused regressions and run canonical verification.
5. Capture desktop/mobile browser evidence and complete product, Claude, and preliminary ReviewGPT reviews.
6. Commit, open the PR, verify CI and mergeability, merge to `main`, and leave the local preview open for inspection.

## Decisions

- Use `/clubs` as the public route because it matches the requested destination and product label.
- Keep the page static and synthetic; no database, API, or runtime changes are justified for this pitch surface.
- Use collective progress as the default hero story because it communicates broad participation without centering an individual leaderboard.

## Verification

- Pending.
