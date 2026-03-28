# Garmin import correctness

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Close the confirmed Garmin snapshot-import correctness gaps so date-bucket data lands on the intended canonical local day, integer-constrained fields never normalize to invalid floats, unsupported snapshot sections are preserved or rejected truthfully, and product/docs copy matches the actual Garmin support boundary.

## Scope

- pass explicit `dayKey` and `timeZone` for Garmin date-only observations where provider records are calendar buckets rather than instants
- treat `summaryDate` as a real Garmin summary timestamp alias instead of silently falling back to `importedAt`
- round or otherwise coerce Garmin duration-derived minute values before they touch integer-only canonical event/sample fields
- restrict Garmin sleep-stage normalization to the canonical allowlist and drop unsupported stage labels instead of emitting invalid canonical samples
- stop treating generic `files` payloads as activity files unless they are clearly activity-file-shaped, while preserving unsupported Garmin top-level sections as raw artifacts
- tighten Garmin-specific snapshot validation at the importer boundary enough to reject clearly invalid shapes without losing forward-compatible raw retention
- add focused importer and core regression coverage for the confirmed failure modes
- make user-facing docs/help text truthful about Garmin snapshot import support vs live sync support

## Non-goals

- adding a live Garmin OAuth, webhook, or daemon connector
- widening the canonical contracts beyond the current event/sample/raw-artifact surface
- redesigning non-Garmin provider adapters

## Files

- `packages/importers/src/device-providers/{garmin.ts,garmin-helpers.ts,garmin-activity-normalizers.ts,garmin-health-normalizers.ts,import-device-provider-snapshot.ts}`
- `packages/importers/test/device-providers.test.ts`
- `packages/core/test/device-import.test.ts`
- `packages/importers/README.md`
- `apps/web/app/page.tsx`
- `packages/cli/src/commands/device.ts`
- `ARCHITECTURE.md` only if the support-boundary language needs durable clarification

## Verification

- focused importer/core tests while iterating
- required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- required completion-workflow audits after functional verification:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Notes

- Prefer preserving unsupported Garmin payloads as raw evidence over silently dropping them.
- Keep activity-file inference conservative: synthetic FIT/GPX/TCX artifacts should only be created when the stored content is actually file content.
- For date-only provider buckets, importer-owned `dayKey` should preserve provider intent without persisting a fallback vault time zone unless the provider actually supplies one.
Completed: 2026-03-28
