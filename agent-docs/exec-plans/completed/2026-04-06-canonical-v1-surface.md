# Canonical v1 surface cleanup

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove or rewrite repo artifacts that still describe Murph as a migrated, bootstrap, or compatibility-era system so the checked-in tree reads as one canonical v1 baseline.

## Success criteria

- Historical or transitional docs that would mislead future agents are either deleted or reframed as current canonical docs.
- SQL migration surfaces are reviewed and any misleading legacy/back-compat wording is removed or replaced where safe.
- Agent-facing architecture and workflow docs no longer imply old architectures or required compatibility paths that the repo has already hard-cut.
- Required verification for the touched repo-internal surfaces passes.

## Scope

- In scope:
  - Repo-wide review of architecture docs, agent docs, review snapshots, and SQL migration directories for stale migration/legacy language.
  - Deleting or rewriting stale docs that are no longer useful for a greenfield canonical v1 repo.
  - Renaming or pruning SQL migration artifacts only where the resulting tree still reflects the current schema truth cleanly.
- Out of scope:
  - Runtime code refactors unrelated to stale docs or migration artifacts.
  - Overwriting unrelated in-progress package-architecture or hosted-runtime work already active in the worktree.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits and avoid overlapping exclusive lanes.
  - Respect current repo workflow and verification requirements for repo-internal docs/process/tooling changes.
- Product/process constraints:
  - The repo should read as a current canonical v1 baseline for future engineers and agents.

## Risks and mitigations

1. Risk: Deleting historical docs or migrations could remove context that still anchors current behavior.
   Mitigation: Inventory first, then keep only artifacts that still describe active behavior; prefer rewriting over deleting when the file remains a live entrypoint.
2. Risk: Cross-cutting docs overlap with active architecture work.
   Mitigation: Avoid unrelated dirty paths unless the cleanup is directly required and reconcile carefully if overlap is unavoidable.

## Tasks

1. Inventory docs, plans, reviews, and SQL migration surfaces for stale legacy/bootstrap/backward-compatibility language.
2. Classify each artifact as keep, rewrite, or delete based on whether it still helps a greenfield v1 repo.
3. Apply the cleanup with minimal surface area and update agent-facing indexes/routing docs as needed.
4. Run required verification and a final audit review before scoped commit.

## Decisions

- Use this pass to remove confusing stale repo history from the live tree, not to preserve archival snapshots for their own sake.
- Prefer current-state canonical docs over historical review snapshots when both occupy agent-visible repo surface.
- Replace the hosted Prisma migration chain with one canonical baseline migration generated directly from `apps/web/prisma/schema.prisma`.
- Keep completed execution plans as process archives, but stop surfacing them as architecture guidance.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm --dir apps/web lint`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output /tmp/murph_prisma_expected.sql`
  - `diff -u /tmp/murph_prisma_expected.sql /tmp/murph_prisma_actual.sql`
  - `pnpm --dir apps/web exec vitest run test/hosted-onboarding-privacy-foundation-migration.test.ts --config vitest.workspace.ts --no-coverage`
  - `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config vitest.config.ts --no-coverage`
- Expected outcomes:
  - `pnpm typecheck`: passed
  - `pnpm --dir apps/web lint`: passed with pre-existing warnings only
  - Prisma diff proof: passed; generated baseline SQL matches the checked-in `2026040600_init` migration except for the one explanatory comment header
  - Focused Vitest checks: both passed
  - `pnpm test:coverage`: failed for an unrelated active package-architecture lane because `packages/cli/scripts/verify-package-shape.ts` rejects the current `@murphai/gateway-core` runtime dependency in `packages/cli/package.json`
Completed: 2026-04-06
