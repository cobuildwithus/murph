# Device source logos and catalog order

Status: completed
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Replace the generic relay glyphs on the six recently added wearable sources
  with crisp, provider-native marks and make their `/connect` ordering reflect
  practical discovery priority.

## Success criteria

- Xiaomi / Mi Fitness, Zepp / Amazfit, RingConn, COROS, Suunto, and Huawei
  Health each render a recognizable high-quality provider logo.
- Huawei, Xiaomi, and Amazfit lead the relay-source group; established direct
  integrations remain ahead of the niche relay brands.
- Production cards and the real design-catalog study use the same visual assets.
- Focused tests, typecheck, frontend proof, required specialist review, and
  exact-head CI pass.

## Scope

- In scope: connect-card logo assets and metadata, source popularity ordering,
  design-catalog examples, focused regression coverage, and PR evidence.
- Out of scope: connection behavior, provider capabilities, setup-guide copy,
  authentication, sync state, and new integrations.

## Constraints

- Reuse the existing `SourceCard` and Apple Health relay flow.
- Use official or provider-published vector/high-resolution image assets and
  preserve accessible decorative-image behavior.
- Keep ordering as one explicit source of truth; do not add ranking machinery.

## Risks and mitigations

1. Risk: wide wordmarks become illegible in the fixed logo area.
   Mitigation: give each asset an accurate intrinsic ratio and verify desktop
   and mobile catalog renders.
2. Risk: a popularity correction accidentally changes connection lifecycle.
   Mitigation: limit behavior changes to the existing order constant and cover
   the sorted result in the focused connect-page test.
3. Risk: the catalog drifts from production asset choices.
   Mitigation: update the existing real-component relay study and its tests in
   the same patch.

## Tasks

1. Add provider-native image assets for all six relay sources.
2. Wire the assets into production and the design catalog.
3. Reorder the catalog and update focused tests.
4. Run focused verification, desktop/mobile visual proof, specialist review,
   exact-head CI, and final parent review.

## Decisions

- Keep global consumer adoption as the first ordering signal for relay sources:
  Huawei Health, Xiaomi / Mi Fitness, then Zepp / Amazfit.
- Keep the existing richer direct integrations ahead of COROS, Suunto, and
  RingConn; those three remain available immediately below them.
- Prefer native SVG assets where a provider publishes one, with high-resolution
  PNG only where that is the provider's practical source format.

## Verification

- Commands to run: focused connect-page tests, Web typecheck, scoped lint,
  frontend design-proof checks, `git diff --check`, desktop/mobile catalog
  rendering, preliminary ReviewGPT product/frontend/coverage lenses, Claude UI
  double-check, and required PR checks on the exact pushed head.
- Expected outcomes: all checks pass, each logo is legible at both viewports,
  sorting matches the explicit priority list, and no connection behavior changes.

## Verification log

- Added the six current provider-submitted iOS app marks as 1024-by-1024 PNGs,
  then losslessly optimized and high-quality quantized them to roughly 180 KB
  total without changing dimensions.
- The focused connect-page Vitest suite passed all 90 tests, including asset
  existence, decorative alt behavior, setup-guide actions, and the full changed
  source order.
- Web typecheck, scoped ESLint, `git diff --check`, and all 10 frontend
  design-proof unit tests passed.
- The real `/design?tab=sections` Apple Health relay study rendered all six
  provider marks and the intended order at a 1440 CSS-pixel desktop viewport
  with 2x density and a 390 CSS-pixel mobile viewport with 3x density. The
  cropped PNG evidence is immediately legible and within the upload limits.
- The preliminary ReviewGPT specialist pass inspected the exact production PNG
  bytes plus desktop and mobile evidence and passed every applicable product,
  frontend, and coverage lens with no findings or coverage patch. The separate
  final full-patch ReviewGPT gate also passed with no findings.
- The required Claude visual-review attempts were made with both supported
  models, but each execution ended without a usable response; no Claude pass is
  claimed. Native-resolution parent inspection and the trusted specialist
  rendered-evidence review provide the completed visual proof.
- The final parent review found no ownership, behavior, accessibility, privacy,
  or regression issue. The PR description now follows the design-proof
  checker's labeled-list contract, and the exact local checker passes for all
  eight user-facing paths. Required GitHub Actions will evaluate the final
  plan-archive head before completion.
Completed: 2026-08-07
