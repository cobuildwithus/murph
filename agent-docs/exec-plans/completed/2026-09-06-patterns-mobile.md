# Readable mobile patterns

## Outcome

Read and compare pattern results on phones without horizontal scrolling.

## Scope and owner

Adapt PersonalPatternsSection at its existing presentation boundary. The mobile
matrix currently fixes outcome widths at seven rem and requires overflow.
Replace it with a native health-measure selector and vertical factor list;
reuse existing sorting, evidence controls, report filtering and pagination.
Keep desktop comparisons and canonical report calculations unchanged.

## Product UX

- Outcome: compare one measure across readable factor rows.
- Reaches: populated phone views, changing measures, sorting, result details,
  Show more, loading; preserve desktop and empty/error states.
- Proof: focused dashboard tests, Web typecheck, rendered synthetic study at
  narrow phone and desktop widths, keyboard and touch-sized controls.

## Progress

- Implemented a native measure selector, vertical factor list, and mobile sorting.
- Removed the mobile scroll listener, resize observer, fade, and fixed-width grid.
- Preserved desktop comparisons, report calculations, details, and pagination.
- Updated the responsive loading skeleton, product/design owners, and changelog.

## Verification and review

- `pnpm --dir apps/web test -- browser-vault-dashboard-pages.test.tsx changelog-page.test.tsx`: 48 tests passed.
- `pnpm --dir apps/web typecheck` and final `typecheck:prepared`: passed.
- `pnpm complexity:diff`: passed, no hotspots above 20 and no added debt.
- `pnpm docs:drift` and `git diff --check`: passed.
- Playwright `e2e/patterns-mobile.spec.ts`: passed at 320, 390, 640 and 1440px.
  Proved measure selection, ascending/descending sorting, opening and dismissing
  result details, 15/19-factor pagination, phone overflow, and 44px result targets.
- Inspected synthetic phone and desktop captures from the production component at
  `/design?tab=components#personal-patterns-component`. Clean captures inspected at native resolution.
- Product UX: Ready. Existing focused tests retain loading, empty, unavailable,
  error, report filtering and comparison semantics. No persistence or external effects.
- Parent review: presentation-only change, reused current report and cell owners,
  privacy scan passed. Final ReviewGPT is exempt for frontend-only presentation.
- Logged the unrelated screenshot-category portal obstruction in the task's Frog
  entry; used the existing component catalog for direct rendered proof.
- Local implementation only; no PR, merge, or deployment performed.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
