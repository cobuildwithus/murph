# Collapse repeated timeline entry projection

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Remove repeated journal, event, and assessment timeline projection while preserving the complete read-only query result.

## Success criteria

- Preserve family inclusion, date and experiment scope, event stream filtering, timestamp and title fallbacks, ordering, and limits.
- Reduce the measured complexity of `buildTimeline` and delete duplicate production code.

## Scope

- In scope: `packages/query/src/timeline.ts` and focused timeline regression tests.
- Out of scope: public API, persistence, product behavior, sample aggregation, and dependencies.

## Constraints

- The existing query read model remains the owner; no canonical state is mutated.
- Assessments remain independent of experiment scope. Journal empty timestamps and event/assessment rejection retain their existing distinct behavior.
- Keep the PR draft for parent candidate review and CI admission.

## Risks and mitigations

1. Shared projection could erase family differences or change ordering.
   Mitigation: prove synthetic family-specific filtering, metadata, invalid/empty occurrence, and bounded output cases against the original implementation before refactoring.

## Tasks

1. Completed: read the timeline, query owner, and existing regression coverage.
2. Completed: added family scope/metadata, invalid/empty occurrence, and limit assertions; all nine focused cases passed against the original source.
3. Completed: consolidated the three family pipelines and removed repeated summary stream filtering and per-summary kind checks.
4. Completed: final focused tests, query typecheck, complexity guard, and source/privacy review passed.
5. Delivery: close the implementation plan and publish the scoped draft candidate for parent review and CI admission.

## Decisions

- Keep family traversal in journal/event/assessment order so complete sort ties retain their stable behavior.
- Use one shared entry projector and an explicit title fallback helper; do not add a registry, dependency, or persisted owner.
- Daily sample summaries already enforce stream filtering, so the timeline's duplicate stream recheck can be deleted.
- No deployment compatibility or rollback contract changes: this is an in-memory behavior-preserving refactor.

## Verification

- Baseline: nine focused cases passed before source edits, including the three new regression cases.
- Final: `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query.test.ts test/health-internals-coverage.test.ts test/browser-vault-replica.test.ts -t 'buildTimeline|buildExportPack renders experiment|export pack, overview, and timeline|browser vault replicas round-trip'` passed all 10 selected tests.
- `pnpm --dir packages/query typecheck` passed after the final TypeScript edits.
- `pnpm complexity:diff --base origin/main -- packages/query/src/timeline.ts` passed: target and file maximum 43 to 19; debt above 20 from 23 to zero; total function complexity 61 to 57.
- Production source: 78 lines added, 115 removed (net deletion of 37 lines). Two duplicate entity projections and filter/occurrence pipelines are gone; no new shared or persisted owner exists.
- `git diff --check` passed. Only the timeline source, its existing test file, and this plan belong to the candidate; no private data or direct personal identifiers were added.
- Broad exact-head CI and parent candidate/final reviews remain owned by the parent session after draft delivery.
Completed: 2026-09-10
