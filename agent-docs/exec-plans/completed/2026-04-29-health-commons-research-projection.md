# Add Health Commons experiment research projection

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Add a generated experiment research-tab projection so `/experiments/[experimentId]/research` can load the minimal public UI model instead of resolving the full route bundle into `ExperimentProtocol`.
- Keep the route bundle as the canonical generated primitive; treat the research projection as a performance projection derived from the same Health Commons catalog data.

## Success Criteria

- Health Commons generation writes `web/tabs/experiments/<routeId>/research.json` for public protocol variants.
- The research projection contains only metadata, revision identity, research landscape, keep-in-mind notes, research stats, research groups, and study-card fields needed by the current Research tab.
- The web research route reads the projection directly and no longer uses the full experiment detail resolver or BrowserVault private-run client wrapper.
- Focused tests prove projection loading, alias resolution, size reduction for Finnish sauna, and parity with the existing full-detail research fields.

## Scope

- In scope:
  - `packages/health-commons/src/web-artifacts.ts`
  - `packages/health-commons/src/build.ts`
  - `packages/health-commons/src/runtime.ts`
  - focused Health Commons tests
  - `apps/web/app/(dashboard)/experiments/[experimentId]/research/**`
  - minimal shared component typing needed for the Research tab
  - focused web tests
- Out of scope:
  - Changing the canonical route bundle closure.
  - Redesigning the Research tab UI.
  - Tab-specific projections for protocol/results/onboarding.
  - Committing generated Health Commons output unless repo policy changes.

## Constraints

- Do not import `apps/web` code or types from `packages/health-commons`.
- Preserve public package boundaries and acyclic workspace dependencies.
- Generated source data in the projection should be snippets/card fields only, not source bodies or full entities.
- Preserve alias behavior for legacy experiment ids.

## Verification

- `pnpm --dir packages/health-commons test:vitest`
- focused hosted-web Vitest for the research projection route/helper
- `pnpm --dir packages/health-commons typecheck`
- `pnpm --dir apps/web typecheck:prepared`
- broader checks as feasible, with unrelated dirty-tree blockers documented.
Completed: 2026-04-29
