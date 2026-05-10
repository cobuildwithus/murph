# Murph Age Query Runtime

## Goal

Add a query-runtime adapter that can calculate Murph Age from a vault-backed user's stored `MetricPoint` data plus explicit age/sex and a supplied validated model.

## Scope

- Add a pure runtime helper under `packages/query` that gathers only the metric points referenced by a supplied `MurphAgeRiskModel`.
- Pass explicit age, sex, `asOf`, model, and retrieved points into `@murphai/health-metrics`.
- Export the runtime helper through the query public entrypoint.
- Add focused query tests proving lab + wearable points are pulled from the query projection and scored, invalid models abstain before data fetch, and future points are not used when `asOf` is set.

## Constraints

- Do not ship a default production model, coefficients, or research-cache artifact in this slice.
- Do not make clinical, recommendation, protocol, or intervention-actionability claims.
- Do not log or expose private metric values beyond the returned calculator result.
- Preserve unrelated active ledger/worktree edits.

## Verification Plan

- `pnpm --dir packages/query test`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query test:coverage`
- `pnpm test:smoke`

## State

- Status: complete
- Started: 2026-05-11
- Completed: 2026-05-11
- Verification: `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/murph-age-runtime.test.ts`, `pnpm --dir packages/query typecheck`, `pnpm --dir packages/query test`, `pnpm --dir packages/query test:coverage`, `pnpm test:smoke`, and scoped `git diff --check` passed. Root `pnpm typecheck` is blocked by an unrelated `packages/cli/test/inbox-cli.test.ts` mock store missing `getAttachment`.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
