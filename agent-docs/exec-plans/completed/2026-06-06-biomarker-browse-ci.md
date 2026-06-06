Goal:
- Fix the failing `Murph Host Support` app verification run by aligning biomarker browse card tests with the intended device-sync pending placeholder behavior.

Success criteria:
- The failing `apps/web/test/biomarker-browse-card.test.ts` cases pass locally.
- Required `apps/web` verification/typecheck coverage is run or any blocker is documented.
- The change stays narrowly scoped and preserves unrelated local edits.

Scope:
- `apps/web` biomarker browse card tests only; production code already uses the intended `deviceSyncImportPending` signal.

Risks:
- Loading placeholder state is user-facing UI behavior tied to browser-vault freshness.
- Current checkout has unrelated supplement-search edits; do not touch or commit them.

Verification plan:
- Focused biomarker browse card Vitest target.
- `pnpm typecheck`.
- `pnpm test:diff` scoped to the touched files when truthful.

State:
- Failing CI run identified: `Release app verification (ubuntu)` fails three biomarker browse card assertions.
- Focused biomarker browse card test passes after updating expectations.
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
