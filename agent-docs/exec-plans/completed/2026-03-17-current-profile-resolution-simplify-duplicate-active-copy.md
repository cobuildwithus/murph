# Current Profile Resolution Simplify

## Goal

Flatten and centralize current-profile resolution in `packages/query` so the strict, tolerant, sync, and query read paths share one behavior-preserving fallback/staleness flow.

## Constraints

- Preserve all externally visible current-profile behavior.
- Preserve tolerant parse-failure collection instead of throwing.
- Preserve `markdownByPath` retention for `bank/profile/current.md` when the document exists but no latest snapshot resolves.
- Do not broaden API renames; keep ownership clarifications local/internal.
- Stop and report if simplification would change subtle fallback behavior.

## Planned Scope

- `packages/query/src/health/current-profile-resolution.ts`
- `packages/query/src/health/profile-snapshots.ts`
- `packages/query/src/health/canonical-collector.ts`
- `packages/query/src/canonical-entities.ts` only if a local naming/ownership clarification is needed
- targeted `packages/query/test/health-tail.test.ts`
- targeted `packages/query/test/query.test.ts`

## Current Read

- `readCurrentProfileState`, `readCurrentProfileStrict`, `readCurrentProfileTolerant`, and `readCurrentProfileTolerantSync` each implement near-identical missing/stale/fallback handling.
- `currentProfileRecordFromEntity` currently assigns both `markdown` and `body` from `entity.body`, and `toCurrentProfileRecord` later overwrites `markdown` with the raw document markdown.
- `canonical-collector` has one subtle extra rule: if `current.md` exists but no latest snapshot resolves, it still records the document markdown while returning `null`.

## Outcome

- Added one shared current-profile document-resolution helper in `current-profile-resolution.ts` to unify missing, parse-failed, stale, and fallback handling plus document-markdown retention decisions.
- Rewired `readCurrentProfileState`, `readCurrentProfileStrict`, `readCurrentProfileTolerant`, and `readCurrentProfileTolerantSync` to use the shared helper without changing exported shapes.
- Clarified local raw-markdown vs projected-body ownership in current-profile query-record projection.
- Added a regression test covering the orphan `current.md` markdown-retention path in the tolerant collector.

## Verification

- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query test`
- completion workflow audit passes with no additional production changes required beyond the focused regression test above
