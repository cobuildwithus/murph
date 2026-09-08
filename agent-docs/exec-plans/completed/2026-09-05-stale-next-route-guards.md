# Remove orphan Next route guards before source typecheck

## Outcome and invariants

Deleted routes must not leave generated guards that break ordinary Web source typecheck. Preserve generated guards for live page, layout, and route sources, unrelated files, and the separate production Next route-contract check. Keep cleanup within validated generated directories without following symlinks.

## Cause and owner

Frog autofix issue: #2790. Current Next 16.3 Webpack emits per-route guards under `.next/types/app`; `scripts/ensure-next-route-type-stubs.ts` removes only the aggregate validator. Direct synthetic Next generation and TypeScript 7 checks proved that an orphan guard survives preparation and still fails with TS2307. Removing only that guard restores the check while live guards remain.

Extend the existing preparation owner. No package dependency, product runtime, deployment, or shared policy change is needed. Generated import paths identify the source; preserve unknown shapes and live source extensions.

## Work and evidence

- [x] Verify committed authority and exclusive sanctioned worktree ownership.
- [x] Prove current Webpack failure and distinguish already-handled validator cleanup.
- [x] Add focused executable regression and confirm failure before repair.
- [x] Implement bounded orphan cleanup and prove live/unknown/symlink preservation.
- [x] Run real generated-fixture TypeScript transition, focused tests, tools typecheck, complexity and privacy review.
- [x] Freeze the implementation candidate for canonical review and required CI; delivery gates continue in the PR.

## Changelog and deployment

Internal developer tooling only; no member-visible changelog or deploy action.

## Candidate verification

The baseline regression failed three cases while ten existing cases passed. The repaired suite passes all fifteen cases, including both generated-directory symlink cases. Focused TypeScript 7 checking and documentation drift checks pass. Complexity debt remains zero; the changed source has no function above twenty.

A current Next 16.3 Webpack build produced real route guards. Source removal fails TypeScript 7 before and after baseline preparation. Repaired preparation removes the orphan and passes; repeated preparation passes. Live page/layout guards are byte-identical, and an invalid live page still fails through its generated guard before restoring the valid page returns green.

Parent review found no unresolved correctness, privacy, ownership, or unnecessary-scope issue. All data is synthetic. External review and required exact-head GitHub checks are pending at this candidate freeze and remain mandatory before landing.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
