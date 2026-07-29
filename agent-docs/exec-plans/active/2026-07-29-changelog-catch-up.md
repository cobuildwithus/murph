# Publish the July 28-29 changelog

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Bring the public `/changelog` archive forward from its July 27 cutoff with
  evidence-backed July 28 and July 29 editions in Murph's existing product
  voice.

## Success criteria

- The two newest editions cover material member-facing behavior merged after
  the prior changelog update without publishing internal operations, tooling,
  or unsupported product claims.
- Stable item ids, edition cursors, feed windows, metadata previews, and the
  seven-edition archive window remain correct.
- Focused tests, canonical verification, rendered desktop and mobile proof,
  required product/frontend review, and PR checks pass.

## Scope

- `apps/web/src/lib/changelog.ts`
- focused changelog registry, page, and route tests
- existing production changelog section and design-catalog study, reused
  without a new component or screen

## Constraints

- Ground every item in merged code and current owner docs.
- Describe member outcomes rather than providers or internal architecture.
- Preserve the existing archive layout, pagination, stable anchors, and
  provider-neutral public language.
- Omit internal dashboards, deployment tooling, observability, migrations, and
  fixes that do not change or restore a clear member-visible outcome.

## Verification

- focused changelog Vitest coverage
- `git diff --check`
- `pnpm test:frontend-design-proof`
- canonical `pnpm test:diff ...`
- desktop and mobile browser proof for `/changelog` and the existing changelog
  design study
- product-experience review, Claude UI double-check, preliminary frontend and
  coverage ReviewGPT lenses, and parent final review

## Progress

- Added evidence-backed July 28 and July 29 editions, supporting visuals, and
  direct `/clubs` navigation through the existing changelog action shape.
- Refreshed `origin/main` after verification and folded the later Clubs
  iMessage-and-supported-wearables presentation into the same July 29 item
  rather than publishing a duplicate entry.
- Updated the existing changelog archive design study with synthetic correction
  evidence and no new component or screen.
- Focused changelog coverage passed: 26 tests.
- `pnpm test:frontend-design-proof` passed: 10 tests.
- Canonical `pnpm test:diff` passed dependency and boundary guards, web
  typecheck, 7,386 tests, lint with no errors, dev smoke, and the production
  Next build.
- Desktop and mobile direct-route checks passed at 1440 by 1100 and 390 by 844:
  the latest edition rendered, the Clubs action resolved to `/clubs`, and
  neither viewport had horizontal overflow.
- The real catalog section rendered against synthetic data at both viewports;
  hosted proof is ready for the PR description.
- The Claude Fable UI double-check was attempted after rendered proof stabilized
  and stopped at explicit credit exhaustion, so no Claude verdict is claimed.
- Product-experience review found one material transport-scope overclaim in the
  participant-change note. The copy now explicitly names supported iMessage
  groups, focused registry coverage preserves that boundary, and the bounded
  re-review returned no findings after inspecting both editions at desktop and
  mobile widths.
