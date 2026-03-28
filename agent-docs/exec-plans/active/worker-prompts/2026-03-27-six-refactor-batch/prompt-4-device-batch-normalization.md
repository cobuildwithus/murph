You are Codex Worker W4 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `AGENTS.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Use the pre-registered ledger row `codex-worker-device-batch-normalization`; update it if scope shifts, and remove it before finishing.
- Keep this behavior-preserving: do not change deterministic record IDs, manifest contents, audit contents, or import ordering.

After changes:
- Run the narrowest truthful tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Tighten the internal types and normalization stages around device/sample imports in `packages/core/src/mutations.ts`, especially `prepareDeviceBatchPlan`.

Relevant files/symbols:
- `packages/core/src/mutations.ts`
  - `LooseRecord`
  - `DeviceEventInput`
  - `DeviceSampleInput`
  - `DeviceRawArtifactInput`
  - `SampleInputRecord`
  - `normalizeLooseRecord`
  - `trimStringList`
  - `normalizeInlineRawContent`
  - `stableStringify`
  - `prepareDeviceBatchPlan`
  - `importDeviceBatch`
  - `importSamples`

Regression anchors to preserve:
- `packages/core/test/device-import.test.ts`
  - inline raw payload import
  - deterministic retry reuse
  - sole-raw-artifact fallback
  - unsupported kind/stream and raw-role validation cases
- `packages/core/test/core.test.ts`
  - `importSamples` normalization/retry/repair cases

Best-guess fix:
1. Keep the public input types loose, but introduce explicit internal normalized device-event, device-sample, and device-raw-artifact shapes.
2. Split `prepareDeviceBatchPlan` into small normalization and attachment stages.
3. After normalization, run the rest of the planner on concrete typed objects instead of `unknown`-shaped records.

Overlap notes:
- This lane stays inside `packages/core/src/mutations.ts` plus direct tests. Preserve existing deterministic ID inputs and the current precedence rules exactly.

