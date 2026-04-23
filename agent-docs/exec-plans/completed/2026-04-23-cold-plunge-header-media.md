Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Set the attached cold-plunge image as the header media for the cold-plunge protocol page without widening beyond the Health Commons experiment-detail media seam.

## Success criteria

- The cold-plunge protocol page owns its hero media in page content instead of relying on a hardcoded app-side route map.
- The experiment-detail renderer prefers page-owned media when present and still falls back safely for other protocols.
- The attached image is stored in repo-owned public assets under a stable cold-plunge-specific name.
- Focused app proof covers the new cold-plunge image resolution path.

## Scope

- In scope: `apps/web` experiment-detail media resolution/rendering, a cold-plunge public asset, the cold-plunge protocol page frontmatter, a focused app test, this active plan, and the coordination-ledger row for this lane.
- Out of scope: broader Health Commons media-system design, redesigning the experiment page layout, or touching unrelated protocol hero images beyond preserving their existing behavior.

## Constraints

- Preserve unrelated dirty-tree work and existing concurrent lanes.
- Reuse the existing experiment hero surface instead of inventing a second header pattern.
- Prefer page-owned content over new hardcoded route exceptions.
- Keep the change small enough to verify with focused app proof plus the repo-required audits.

## Tasks

1. [x] Register the lane in the coordination ledger.
2. [x] Wire the experiment-detail resolver to prefer protocol-page media.
3. [x] Add the cold-plunge asset and protocol frontmatter media entry.
4. [x] Update focused tests for the cold-plunge media resolution path.
5. [ ] Run verification, required audits, and a scoped commit.

## Progress notes

- Confirmed `apps/web` currently renders experiment heroes through `ExperimentHero`, but the image source is still selected inside `apps/web/src/lib/health-commons/experiment-detail.ts` from hardcoded route-ID constants.
- Confirmed `packages/contracts/src/health-commons.ts` allows passthrough frontmatter fields, so a `media` block can be stored on protocol pages without widening the base schema first.
- Confirmed the current cold-plunge protocol lives at `packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md`.
- Recovered the attached image from the prior Codex session log, wrote the public asset under `apps/web/public/design-assets/cold-plunge-tub.jpeg`, and removed the unused PNG copy so the shipped diff stays small.
- Updated `packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md` to declare page-owned `media` pointing at `design-assets/cold-plunge-tub.jpeg` with caption `Cold plunge tub`.
- Updated `apps/web/src/lib/health-commons/experiment-detail.ts` so protocol-page `media` image entries are preferred before the existing hardcoded route map and heuristic fallback.
- Regenerated the Health Commons catalog artifacts so the page-owned media reaches the app through `@murphai/health-commons/generated/catalog.json`.

## Verification

- Passed: `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts apps/web/test/health-commons-experiment-detail-page.test.ts --no-coverage`
- Passed: `pnpm --filter @murphai/health-commons generate`
- Passed: `pnpm --filter @murphai/health-commons generate:check`
- Passed: `git diff --check`
- Failed for unrelated pre-existing reasons: `pnpm typecheck`
  - unrelated workspace-boundary violations in `packages/cli` importing non-public assistant-engine entrypoints
  - unrelated pre-existing `apps/web` type errors in hosted execution and onboarding files/tests
- Failed for unrelated pre-existing reasons while still providing useful scenario proof: `pnpm test:diff apps/web/src/lib/health-commons/experiment-detail.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts packages/health-commons/content/protocols/cold-water-immersion/cold-plunge.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson apps/web/public/design-assets/cold-plunge-tub.jpeg`
  - unrelated pre-existing workspace-boundary violations
  - unrelated pre-existing `apps/web` verify failures across hosted onboarding, hosted execution, and local-heartbeat tests
  - direct proof from the emitted markup showed the cold-plunge library card resolving `/_next/image?url=%2Fdesign-assets%2Fcold-plunge-tub.jpeg...`
- Required audit passes completed with no blocking findings:
  - `coverage-write` (no extra tests needed)
  - `frontend-review` (no material frontend issues; future-only watchpoint if protocol pages later carry multiple presentation assets)
  - `task-finish-review` (no material issues)
Completed: 2026-04-23
