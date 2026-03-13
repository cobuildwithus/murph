# 2026-03-13 Query Read Model Simplify

## Goal

Reduce immediate duplication and nesting in the allowed query read-model and health reader modules without changing read semantics, exported signatures, record shapes, or sort/filter behavior.

## Success Criteria

- `packages/query/src/model.ts` keeps the same canonicalization and record-listing behavior while simplifying JSONL reading, directory walking, and record-family control flow.
- `packages/query/src/export-pack-health.ts` keeps the same health export results while reducing repeated file walking, JSONL parsing, and sort/filter wrappers.
- Allowed `packages/query/src/health/*.ts` modules keep the same date/text filtering and ordering semantics while using flatter helper boundaries for repeated mapper/filter/sort flows.
- No files or symbols owned by other active ledger rows are touched.

## Constraints

- Preserve all public export names/signatures and output object shapes.
- Do not edit forbidden files or files currently owned by other active ledger rows.
- Do not extract new shared utilities outside the allowed query package files.
- Work on top of the current dirty tree without reverting unrelated edits.

## Planned Files

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-query-read-model-simplify.md`
- `packages/query/src/model.ts`
- `packages/query/src/export-pack-health.ts`
- `packages/query/src/summaries.ts`
- `packages/query/src/health/assessments.ts`
- `packages/query/src/health/allergies.ts`
- `packages/query/src/health/conditions.ts`
- `packages/query/src/health/family.ts`
- `packages/query/src/health/genetics.ts`
- `packages/query/src/health/goals.ts`
- `packages/query/src/health/history.ts`
- `packages/query/src/health/profile-snapshots.ts`
- `packages/query/src/health/registries.ts`
- `packages/query/src/health/regimens.ts`

## Notes

- Leave `packages/query/src/markdown.ts`, `packages/query/src/health/shared.ts`, `packages/query/test/health-tail.test.ts`, and `packages/query/src/export-pack.ts` untouched because other active ledger rows own them.
- If a useful simplification depends on those owned files, record it in handoff instead of applying it.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
