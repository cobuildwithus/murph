# Wearable provider-scope read-time composition

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Remove wearable provider subset precomputation from the query projection path so provider filters are composed from provider-keyed atomic daily summary rows at read time.

## Success criteria

- Multi-provider wearable queries return the composed result when all requested providers have rows, instead of silently returning empty because a subset scope was not materialized.
- The projection table stores provider-keyed daily summary facts rather than all provider combinations.
- Focused query tests cover single-provider, multi-provider, and all-provider behavior.
- Required package verification, typecheck, completion audits, and privacy/diff checks run or any unrelated blockers are recorded.

## Scope

- In scope:
- `packages/query` wearable projection schema/read-model code and focused tests.
- Minimal query package docs only if the persisted projection contract changes need durable explanation.
- Out of scope:
- Importer/provider normalization changes.
- Hosted web, Cloudflare, device-sync runtime, or live provider behavior.

## Constraints

- Technical constraints:
- Query projection state is rebuildable under `.runtime/projections/**`; do not introduce canonical health truth or new operational state.
- Preserve package-boundary ownership and avoid reaching across package internals.
- Prefer simple read-time composition over materializing combinations of filters.
- Product/process constraints:
- Do not inspect or print raw live health payloads, local paths, account IDs, provider secrets, or direct personal identifiers.
- Preserve unrelated dirty worktree and ledger edits.

## Risks and mitigations

1. Risk: Changing aggregate semantics could alter all-provider summaries.
   Mitigation: Add focused tests comparing all-provider and filtered behavior from provider-keyed rows.
2. Risk: Existing projection databases may contain old combination rows.
   Mitigation: Trace the migration/rebuild path and keep compatibility or migration handling explicit.

## Tasks

1. Locate current provider-scope materialization, schema, query read path, and tests.
2. Add or update focused tests for multi-provider read-time composition.
3. Change the projection writer to store atomic provider-keyed daily rows and the reader to aggregate requested providers.
4. Verify migration/rebuild behavior for existing projection stores.
5. Run required checks and completion audits, inspect diff/privacy hygiene, and finish through the plan commit path if safe.

## Decisions

- Use read-time composition as the target shape unless local evidence shows the existing schema cannot support it without an unsafe migration.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/query`
- Additional focused `packages/query` test command if `test:diff` does not cover the exact regression.
- Expected outcomes: query package tests and typecheck pass, or unrelated existing failures are documented with focused proof.
Completed: 2026-05-27
