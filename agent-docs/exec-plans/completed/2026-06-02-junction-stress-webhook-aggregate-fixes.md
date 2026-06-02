# 2026-06-02 Junction Stress Webhook Aggregate Fixes

## Goal

Fix the stress-level follow-up bugs found in deep review while preserving the
simple architecture: Junction dense stress timeseries remains raw/debug
evidence, and query-visible stress is a compact daily aggregate fact.

Success criteria:

- `stress_level` webhooks do not direct-import small dense payloads or suppress
  the bounded grouped REST fetch.
- Fallback webhook fetch windows can infer timestamps from grouped or nested
  timeseries records.
- Fetched/imported stress samples accept the provider `score` alias where the
  previous summary path did.
- Daily stress aggregates bucket by explicit local offset metadata when present,
  without adding new persisted state or broad abstractions.
- Focused importer/device-sync tests, typecheck, required audits, and scoped
  verification pass or have clearly unrelated blockers recorded.

## Scope

- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/device-syncd/src/providers/junction.ts`
- `packages/device-syncd/test/junction-resource-aliases.test.ts`

## Out Of Scope

- Reworking the broader Junction sync architecture.
- Changing query selection policy beyond making correctly emitted aggregates
  visible through the existing metric catalog.
- Retaining dense stress samples in canonical samples or default query output.
- Touching unrelated assistant-engine, assistant-runtime, or Murph Age worktree
  changes.

## Verification Plan

- Focused importer tests for stress aggregation aliases and day bucket behavior.
- Focused device-syncd tests for stress webhook fetch routing and nested/grouped
  fallback windows.
- `pnpm --dir packages/importers test -- device-providers-junction`
- `pnpm --dir packages/device-syncd test -- junction-resource-aliases`
- `pnpm --dir packages/importers typecheck`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm typecheck` if not blocked by unrelated dirty assistant-runtime work.
- Required completion audits: security/privacy review, coverage-write,
  task-finish review.

## Notes

- Preserve unrelated dirty work.
- Keep the fix explicit and local to Junction provider seams.
- Webhooks are freshness/routing hints; complete daily aggregates should come
  from bounded provider fetches unless a payload contract proves completeness.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
