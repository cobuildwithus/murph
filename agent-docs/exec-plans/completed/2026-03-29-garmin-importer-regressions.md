# Garmin Importer Regressions

## Goal

Fix the reported Garmin importer regressions without widening the importer seam:

- preserve stable activity-file role linkage and canonical activity-session IDs for metadata-only Garmin files
- make Garmin date-bucket `occurredAt`/`recordedAt` consistent with `dayKey` and provider `timeZone`
- preserve non-object Garmin file-section payloads as raw evidence instead of rejecting them at parse time
- ensure retained-section provenance only claims sections that actually produced raw artifacts
- align the hosted landing-page copy with the current Garmin importer-only support boundary

## Scope

- `packages/importers/src/device-providers/{garmin.ts,garmin-activity-normalizers.ts,garmin-health-normalizers.ts,shared-normalization.ts}`
- `packages/core/src/mutations.ts`
- `packages/importers/test/device-providers.test.ts`
- `apps/web/app/page.tsx`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve existing canonical compatibility where feasible, especially activity-file role naming and deterministic device event ID seeds.
- Keep unsupported Garmin file-ish payloads as conservative raw evidence rather than broadening normalization.
- Do not revert unrelated dirty worktree changes.
- Run required verification and mandatory completion-workflow audit passes before handoff.

## Risks

- Canonical ID churn if raw artifact roles change for metadata-only files.
- Timezone/day-key inconsistencies for date-only Garmin summaries.
- Over-tight schema changes rejecting payloads that should be retained raw.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused Garmin importer test execution if needed during iteration
- direct scenario check: inspect updated Garmin normalization tests that prove stable activity linkage, timezone-consistent buckets, conservative raw retention, and truthful retained-section provenance
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
