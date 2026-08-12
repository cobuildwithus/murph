# Junction summary specialist remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Correct Junction activity units and calendar-date admission, then make versioned profile and menstrual snapshots authoritative over the bounded canonical facets they own.

## Success criteria

- Activity low/medium/high values remain minute-valued, each bounded to 0..1440, with aggregate activity minutes bounded to 1440.
- Calendar-invalid menstrual endpoints and subfacts stay evidence-only; valid leap-day facts and lengths remain canonical.
- Newer versioned profile/cycle snapshots revise stable facets and tombstone omitted owned facets through core's existing external-ref reconciliation owner.
- Older or unversioned snapshots cannot retract facts; simultaneously present same-day facts remain distinct.
- Garmin plus Oura/WHOOP-shaped activity data and profile/cycle corrections pass normalizer and real-core replay tests with zero samples and exact corrected replay no-ops.

## Scope

- In scope: Junction summary normalization, a bounded authoritative-facet-set extension to the existing core device batch reconciliation, focused tests, compatibility/changelog copy, PR verification and metadata.
- Out of scope: a retraction service, persisted importer state, broad provider membership management, dense samples, full snapshots, unrelated audit findings, or another ReviewGPT run.

## Architecture decision

- `packages/core` already owns vault-wide external-reference reconciliation, event-spine revisions, and append-only tombstones. Extend that existing batch owner with bounded, versioned authoritative facet sets. The Junction importer declares only profile and menstrual resource facets for which the provider snapshot is complete and has a comparable provider revision.
- Stable resource identity is based on the provider record ID, not mutable values or sync time. Same-day repeated menstrual facts use deterministic ordinal slots, allowing a single corrected fact to revise while preserving multiple facts simultaneously present in the latest snapshot.

## Tasks

1. Correct activity minute semantics and strict menstrual date admission.
2. Add bounded authoritative facet-set validation and reconciliation in the existing core device import path.
3. Emit stable, versioned profile/cycle identities and deterministic current facet sets from Junction.
4. Add production-shaped normalizer/core replay and correction/removal regressions.
5. Update docs/changelog, run scoped verification, commit, push, and update PR #1702.

## Verification

- `pnpm --dir packages/importers test -- device-providers-junction.test.ts` (15 files, 391 tests passed)
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts test/import-device-batch-validation.test.ts` (2 files, 187 tests passed)
- `pnpm --dir packages/contracts test` (37 files, 280 tests plus schema artifacts passed)
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/changelog-fragments.test.ts apps/web/test/changelog.test.ts` (2 files, 44 tests passed)
- `pnpm --dir packages/importers typecheck`, `pnpm --dir packages/core typecheck`, `pnpm --dir packages/contracts typecheck`, and `pnpm --dir apps/web typecheck:prepared` passed.
- `pnpm test:scenario-integrity` and `pnpm deps:guard` passed.
- `git diff --check`, identifier/secret-pattern review, and `scripts/frog list` passed; no new repository friction was encountered.
Completed: 2026-08-11
