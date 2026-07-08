Goal (incl. success criteria):
- Fix Junction sleep normalization so Apple HealthKit sleep summaries with impossible zero asleep metrics cannot beat valid direct WHOOP sleep data.
- Success means same-window direct WHOOP Junction sleep remains selected for total/stages/efficiency when Apple HealthKit has a zeroed summary, while Apple generic asleep intervals can still contribute non-stage total sleep when no better direct source exists.

Constraints/Assumptions:
- Keep provider-specific behavior in the Junction importer and sleep query selection path.
- Do not invent Apple REM/deep/light stages from generic HealthKit `Asleep` intervals.
- Preserve sleep windows and awake minutes from Apple HealthKit when they are valid.
- Preserve unrelated active ledger rows and current checkout edits.

Key decisions:
- Treat Junction Apple HealthKit `sleep_cycle.stage_type = -1` as asleep-unspecified for total-sleep derivation only.
- Suppress zeroed Apple HealthKit summary total/efficiency/asleep-stage facts when a real window and awake intervals exist.
- Add read-side filtering so already-imported bad Apple zero observations and projected summaries cannot continue winning selection.

State:
- Complete; ready for scoped commit.

Done:
- Confirmed raw Junction Apple HealthKit summary contains zero total/efficiency/asleep stages despite a real sleep window and awake intervals.
- Confirmed Apple Health app samples shown by the user are WHOOP-sourced HealthKit sleep intervals, not independent Apple Watch detailed stages.
- Implemented Junction importer handling for generic `-1` asleep intervals and zeroed Apple HealthKit summary suppression.
- Implemented sleep query selection safeguards for existing zeroed Apple HealthKit candidates and duplicate HealthKit sleep windows.
- Added focused importer, raw-query, trend, and stored-projection regression coverage.
- Verified `@murphai/importers` focused tests and typecheck, `@murphai/query` focused sleep/projection tests, and `git diff --check`.

Now:
- Commit scoped fix and archive this plan.

Next:
- Backfill/rebuild the affected vault projection after this fix lands.

Open questions (UNCONFIRMED if needed):
- Junction does not publicly document `stage_type = -1`; mapping is inferred from raw Apple HealthKit-via-Junction payloads and user-provided Health sample screenshots.
- `pnpm --filter @murphai/query typecheck` remains blocked by unrelated Murph Age type/module errors outside this task.

Working set (files/ids/commands):
- packages/importers/src/device-providers/junction.ts
- packages/importers/src/device-providers/junction-resources.ts
- packages/importers/test/device-providers-junction.test.ts
- packages/query/src/wearables.ts
- packages/query/test/wearable-summary-stored-codec.test.ts
- packages/query/test/wearables-sleep-session-anchor.test.ts
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
