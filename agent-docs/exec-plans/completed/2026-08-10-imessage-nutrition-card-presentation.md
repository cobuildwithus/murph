# Polish the iMessage nutrition card presentation

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the static iMessage nutrition card read as one native card instead of a
  bitmap nested inside another card, while preserving its useful nutrition
  summary and interactive app-card behavior.

## Success criteria

- The generated bitmap contains no Murph badge and no baked-in corner radius.
- The Linq nutrition layout sends the date and meal count without repeating the
  visible nutrition totals or goal amounts in a long subcaption.
- Compact-table cards retain their existing captions.
- The real production component is represented and inspected in the design
  catalog at desktop and mobile sizes.
- Focused Web, operator-config, and Cloudflare request-shape tests pass, followed
  by exact-head CI and the required ReviewGPT gates.

## Scope

- In scope: the generated nutrition image, Linq nutrition layout shape, design
  catalog study, direct request-shape tests, and matching
  durable presentation contracts.
- Out of scope: changing the interactive iMessage app, App Store identity,
  nutrition calculations, goals, or delivery ownership.

## Constraints

- Technical constraints: Linq owns the native app icon and outer card chrome;
  the image and optional captions must compose inside that provider surface.
- Product/process constraints: preserve the app-card action and text recovery,
  keep the solution deletion-first, and do not persist confidential visual
  feedback in repository artifacts.

## Risks and mitigations

1. Risk: Omitting `subcaption` could accidentally affect compact-table cards.
   Mitigation: Make the field optional at the shared layout boundary, preserve
   it for partial nutrition cards, and retain exact compact-table request-shape
   coverage.
2. Risk: Removing bitmap rounding could look unfinished outside Messages.
   Mitigation: Keep native/card-shell clipping in the design study and inspect
   the production component at both routed viewport sizes.
3. Risk: Web and Cloudflare deploys can temporarily serve different halves of
   the presentation change.
   Mitigation: Preserve bidirectional compatibility and deploy Web before the
   Cloudflare runtime, then verify the live image and provider request shape.

## Tasks

1. Remove the generated badge and bitmap-owned rounding.
2. Omit the nutrition detail subcaption without changing other app-card layouts.
3. Update direct tests, catalog copy, and durable presentation contracts.
4. Capture rendered desktop/mobile proof and run focused verification.
5. Complete exact-head CI, specialist/final ReviewGPT, safe deployment, and
   post-deploy checks.

## Decisions

- Preserve `app_store_id`; Linq's native app icon and app action remain
  provider-owned.
- Keep the short date and meal-count caption as the minimum useful card label.
- Omit `subcaption` rather than sending an empty string for complete nutrition
  cards without assessed context; retain only a short partial-state warning and
  concise assessed-goal directions, never repeated totals or target amounts.
- Continue the existing `buildLinqIMessageAppLayout` subcaption derivation as
  the sole static semantic owner after the required anomaly retrospective; do
  not add alternate text channels, delivery branches, or fallback-value leaks.

## Verification

- Focused Vitest files for the image route/component, layout builder, Linq
  request mapping, and scheduled Cloudflare delivery.
- Targeted Web and operator-config typechecks plus scoped lint and doc drift.
- Desktop/mobile catalog screenshots and post-Vercel raw image inspection.
- Exact-head required CI, preliminary specialist review, final ReviewGPT, clean
  merge proof, and live Web/Cloudflare deployment checks.

## Progress

- [x] Deleted the generated badge, bitmap corner mask, and nutrition-detail
  subcaption formatter; compact-table captions remain unchanged.
- [x] Updated exact layout/provider expectations and the design, architecture,
  reliability, deliverability, and index contracts.
- [x] Passed 10 focused Web tests, 72 operator-config layout/runtime tests, Web,
  operator-config, and Cloudflare TypeScript checks, scoped Web lint, doc drift,
  diff checks, and the frontend-design-proof guard tests.
- [x] Captured and inspected synthetic desktop 2x and mobile 3x catalog proofs;
  the mobile proof also caught and resolved a catalog-only overflow.
- [x] Attempted the required Claude Code UI double-check; Fable reported
  explicit usage-credit exhaustion, so no substitute review was run.
- [x] Pushed the candidate and attached hosted desktop/mobile design proof;
  exact-head required CI passed.
- [x] Completed the preliminary specialist pass and three substantive final
  rounds. The first two findings restored partial/unavailable truth and concise
  assessed-goal direction at the existing owner; the completed retrospective
  justified that irreducible shape, and the same-head round-3 retry passed with
  no remaining finding.
- [x] Proved a clean merge tree against current `main`. The approved source
  candidate is ready for the required post-merge Vercel-first, Cloudflare-second
  production rollout and live provider checks.
Completed: 2026-08-10
