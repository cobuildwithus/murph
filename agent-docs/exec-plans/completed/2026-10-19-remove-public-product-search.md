# Remove public product search and food comparison

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Goal

Remove the standalone public product search and food comparison experiences and their exclusive machinery. Preserve assistant nutrition lookup, food logging, the labels database, and `/compare`.

## Scope and authority

The user requested removal only, with a separate worktree and PR for each scope. No replacement features, redirects, database changes, deployment, or merge are in scope.

## Architecture and protected behavior

Private authenticated `/api/foods` and `/api/supplements` remain the lookup authority. Public routes, DTOs, UI, assets, ranking, and query projections are obsolete. Reuse existing nutrition normalization locally where private food lookup still depends on it. Keep unrelated referral and companion-diagnostic WAF checks.

## Tasks

1. Trace public-only and shared dependencies.
2. Remove pages, API routes, components, contracts, assets, and discovery links.
3. Remove public database projections while preserving private queries and exact contaminant links.
4. Update durable owner docs and retained tests; verify private lookup, configuration, and types.
5. Review the candidate, commit, and open a draft PR for parent-owned review and CI completion.

## Product UX

Public visitors no longer see search or comparison links; old product URLs use the existing not-found behavior. Assistant nutrition questions and logged meals retain their existing lookup path. The separate `/compare` site remains unchanged. Route inventories, focused private-lookup tests, and typechecking provide deletion and retained-path evidence.

## Risks and mitigations

Public and private SQL share helpers: remove public branches with focused private food and supplement tests. The normalizer is shared with meal lookup: retain its serving and nutrition behavior. WAF verification also protects unrelated routes: remove only product rules. Existing public links become not-found by the requested removal-only boundary.

## Verification

- Private lookup unit, route, and pool tests: 131 passed.
- Real PostgreSQL private lookup suite: 144 passed against the reserved local test database, using transaction-scoped temporary tables. Includes exact ID/UPC, evidence, ranking, and 250,000-row bounded-query proof.
- Before/after private SQL compared across 16 food/supplement query configurations; only public no-op filters and zero offsets disappeared.
- Nutrition normalization, Next configuration, telemetry, and search metadata: 76 passed.
- Changelog rendering and ordinary authentication: 56 passed. Shared WAF tests passed.
- `pnpm --dir apps/web typecheck:prepared` and `pnpm --dir packages/contracts typecheck`: passed after standard generated-input preparation.
- `pnpm complexity:diff`, `bash scripts/check-agent-docs-drift.sh`, and `git diff --check`: passed. The retained contaminant-threshold scorer is unchanged at complexity 21.
- Focused ESLint: zero errors; one pre-existing unused callback-pattern warning.
- Added-content privacy and repository-local Git identity checks passed privately.
- The existing homepage nutrition study remains the presentation owner; its public-search link is deleted. Existing comparison routes and their content remain unchanged.
- Historical changelog action corrections: 2026-07-16 `murph-safe-product-search` and 2026-09-02 `compare-branded-foods` lose dead navigation only. New removal note: 2026-10-19 `retire-public-product-search`.
- Exact-head CI and independent candidate review remain owned by the parent PR-completion session. No deployment or database migration is part of this change.
Completed: 2026-10-19
