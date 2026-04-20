# Health Commons Patch

## Goal

Land the supplied Health Commons architecture patch on top of the current repo snapshot without disturbing the unrelated hosted-run and hosted-web work already in flight.

## Why this exists

- The supplied patch introduces a new `packages/health-commons` owner package plus shared contracts, deterministic generated artifacts, and a product spec for the public/reference knowledge layer.
- The repo already has established seams for health-library entities, generated artifacts, and durable Markdown truth, so the landing needs to preserve those seams rather than creating parallel storage or bypassing current package boundaries.
- The tree is already dirty with unrelated active work, so this lane needs an explicit coordination notice and a tightly scoped commit.

## Scope

- `agent-docs/index.md`
- `agent-docs/product-specs/{index.md,health-commons.md}`
- `packages/contracts/**`
- `packages/health-commons/**`
- `packages/query/src/health-library.ts`
- Root TypeScript workspace config touched by the supplied patch

## Non-goals

- Any hosted-run, hosted-wake, hosted onboarding, or Cloudflare work already active in the tree
- Refactoring beyond what the supplied patch already changes
- Expanding the seed content beyond the supplied Health Commons scaffolding

## Constraints

- Preserve unrelated dirty-tree edits.
- Keep large raw artifacts out of Git and generated artifacts deterministic.
- Honor the repo's existing health-library/entity vocabulary instead of creating a competing registry.
- Verify with scoped package checks plus direct generated-artifact proof.

## Planned shape

1. Register a narrow Health Commons lane in the coordination ledger.
2. Apply the supplied patch as-is on top of the current snapshot.
3. Inspect the landed diff for package-boundary, generated-artifact, and doc-index consistency.
4. Run scoped verification for the touched owners.
5. Commit only the Health Commons paths with a narrow summary.

## Verification target

- `pnpm typecheck`
- `pnpm test:diff -- agent-docs/index.md agent-docs/product-specs/index.md agent-docs/product-specs/health-commons.md packages/contracts packages/query packages/health-commons tsconfig.base.json tsconfig.json`
- `pnpm test:smoke`
- `pnpm --dir packages/health-commons verify`
- Direct generated-artifact regeneration check via `pnpm --filter @murphai/health-commons generate:check`

## Current state

- The supplied patch applies cleanly against the current repo snapshot.
- Node and pnpm already satisfy the repo engine requirements.
- Active hosted-run and hosted-web rows in the coordination ledger do not overlap with the Health Commons file set.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
