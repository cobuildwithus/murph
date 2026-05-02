# Land greenfield MetricPoint architecture hard cut

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied greenfield MetricPoint architecture hard cut: move neutral metric identity, normalization, selectors, and MetricPoint contracts into a new `@murphai/health-metrics` owner package; make `packages/query` extract and persist neutral metric points; and keep browser-vault metric payloads as projection adapters over that query-owned shape.

## Success criteria

- `@murphai/health-metrics` is a private workspace package with build/typecheck wiring.
- `packages/query` owns MetricPoint extraction from canonical entities and metric rows, persists the neutral query metric-point table, and exports read/selection helpers through public package entrypoints.
- Browser-vault metric point and selection helpers still produce compact browser projection rows from the neutral MetricPoint layer.
- Durable architecture/docs references include the new package owner and query projection behavior where needed.
- Focused query/package verification and required repo checks either pass or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/health-metrics/**`
  - `packages/query/src/{metrics,browser-replica,query-projection,index}.ts`
  - Directly coupled query tests, package manifests, root TypeScript references, lockfile, and durable architecture docs
- Out of scope:
  - Wearable importer/provider source selection policy outside the direct MetricPoint extraction layer
  - Hosted web/browser UI redesign
  - New canonical vault record shapes

## Constraints

- Technical constraints:
  - Keep package imports through declared package entrypoints.
  - Keep query projection state rebuildable under `.runtime/projections`.
  - Avoid `as any` and broad assertion shortcuts; isolate JSON boundaries narrowly where unavoidable.
  - Preserve unrelated dirty work already present in the shared checkout.
- Product/process constraints:
  - Treat supplied patch as behavioral intent, not overwrite authority.
  - Do not expose local account paths or personal identifiers in committed artifacts.

## Risks and mitigations

1. Risk: Query projection schema change breaks existing rebuild/read helpers.
   Mitigation: Add or update focused query tests around metric-point persistence and selections, then run typecheck and query verification.
2. Risk: New workspace package wiring is incomplete.
   Mitigation: Update TypeScript references, package dependency metadata, lockfile, architecture docs, and package-boundary verification.
3. Risk: Adjacent active query metric rows conflict conceptually.
   Mitigation: Keep this lane narrow to the supplied hard cut, verify target files were clean before edits, and note the overlap in the ledger.

## Tasks

1. Apply the supplied patch intent to add `@murphai/health-metrics` and query MetricPoint extraction/projection wiring.
2. Reconcile package/docs/test fallout from current repo state.
3. Run focused verification and privacy/diff checks.
4. Close plan and commit a scoped landing if verification is acceptable and unrelated dirty work can be preserved.

## Decisions

- Use a plan-bearing lane because this supplied patch introduces a new owner package and changes the query projection schema.

## Verification

- Commands to run:
  - `pnpm install --lockfile-only` if the workspace lockfile needs the new package entry
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - `pnpm --dir packages/query test:coverage` if diff-aware verification is not truthful enough
  - `git diff --check`
- Expected outcomes:
  - Required checks pass, or unrelated pre-existing failures are named with evidence.
Completed: 2026-05-02
