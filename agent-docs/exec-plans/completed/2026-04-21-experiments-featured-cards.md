# Feature dry sauna and 4x4 experiments

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Make the `/experiments` featured section highlight the public dry-sauna and Norwegian 4x4 protocols instead of surfacing the Bryan Johnson sauna protocol as a featured card.

## Success criteria

- Default `/experiments` featured cards include `finnish-sauna` and `norwegian-4x4`.
- Bryan Johnson may remain browseable in the full library, but is not selected for the featured section.
- Focused web tests and typecheck pass or any unrelated blocker is documented.

## Scope

- In scope: featured-card selection/copy and direct tests for the experiments page.
- Out of scope: Health Commons source corpus changes, protocol-detail page redesign, generated catalog rewrites unrelated to featured selection.

## Constraints

- Technical constraints: preserve private browser-vault overlays on protocol cards; keep category/search filtering coherent.
- Product/process constraints: preserve unrelated dirty Health Commons and experiment-detail edits already in the worktree.

## Risks and mitigations

1. Risk: Existing dirty experiment files overlap this page.
   Mitigation: read current file state first and patch only the featured selector/copy/test assertions needed for this request.

## Tasks

1. Inspect current `/experiments` featured selection behavior.
2. Pin dry sauna and Norwegian 4x4 as featured protocols.
3. Add or update focused tests.
4. Run scoped verification and commit exact touched paths.

## Decisions

- Keep the full library browseable, including Bryan Johnson, but exclude Bryan Johnson from the featured-card picker.
- Pin featured cards by route id (`finnish-sauna`, `norwegian-4x4`) so copy/title changes do not affect the featured contract.

## Verification

- Passed: `pnpm --dir . exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/browser-vault-dashboard-pages.test.tsx --no-coverage`.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `git diff --check`.
