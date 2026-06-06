Goal (incl. success criteria):
- Simplify device provider dense telemetry admission so core rejects only oversized sample-row imports, while numeric observation events import without observation-grain gatekeeping.
- Remove unused debug bypass policy from the live import surface.
- Update tests and durable docs to match the simpler rule.

Constraints/Assumptions:
- Preserve unrelated dirty work and ledger rows.
- Do not weaken the protection against provider firehose data landing in `ledger/samples/**`.
- Keep provider adapters using compact raw artifacts and summary observations for product facts.

Key decisions:
- The real storage-risk boundary is canonical sample rows, not numeric observation count.
- No production caller currently needs a dense-debug bypass.

State:
- Complete; ready to close.

Done:
- Re-reviewed core guard, importer handoff, and wearable retention docs.
- Removed the observation-event admission counter and dense debug bypass policy from `importDeviceBatch`.
- Kept the provider sample-row cap as the only core dense telemetry admission guard.
- Updated focused core/importer tests and current docs.
- Verification passed:
  - `pnpm --dir packages/core test -- device-import.test.ts`
  - `pnpm --dir packages/importers test -- device-providers.test.ts`
  - `pnpm --dir packages/device-syncd test -- junction-provider.test.ts`
  - `pnpm --dir packages/core test:coverage`
  - `pnpm --dir packages/importers test:coverage`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Static provider search found no in-tree Junction/Oura/WHOOP/importer use of `queryVisibility`, `visibility`, or `canonicalFact` outside the new core tests.
- `bash scripts/workspace-verify.sh test:diff packages/core/src/mutations.ts packages/core/test/device-import.test.ts packages/importers/test/device-providers.test.ts docs/contracts/02-record-schemas.md docs/device-provider-compatibility-matrix.md docs/device-provider-contribution-kit.md` failed in unrelated `packages/assistant-engine/test/assistant-skill-assets.test.ts` because dirty onboarding skill work is missing an expected supplement-save sentence.
- Required audit loop complete:
  - Initial coverage findings accepted and fixed with boundary/promotion tests.
  - Initial security finding accepted and fixed by rejecting device-import query promotion fields.
  - Rerun coverage/security/final review had no findings.

Now:
- Close active plan.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/core/src/mutations.ts`
- `packages/core/test/device-import.test.ts`
- `packages/importers/test/device-providers.test.ts`
- `docs/contracts/02-record-schemas.md`
- `docs/device-provider-compatibility-matrix.md`
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
