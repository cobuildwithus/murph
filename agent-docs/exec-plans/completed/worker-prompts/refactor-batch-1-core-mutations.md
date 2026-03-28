You are Codex Worker R1 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker R1` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to the files listed below.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Separate canonical payload normalization from ID assignment in device-batch mutations without changing behavior.

Relevant files/symbols:
- `packages/core/src/mutations.ts`
  - `buildEventRecord`
  - `buildSampleRecord`
  - `deterministicContractId`
  - `prepareDeviceBatchPlan`
- Regression anchors:
  - `packages/core/test/device-import.test.ts`

Best-guess fix:
1. Extract id-free normalized seed builders such as `buildNormalizedEventSeed(...)` and `buildNormalizedSampleSeed(...)`.
2. Let the seed builders own normalization/defaulting/validation/day-key calculation but not `id`.
3. Compute deterministic IDs from the normalized seed instead of creating fake placeholder ids and stripping them back out.
4. Add a thin finalizer that takes `{ seed, recordId }` and returns the full canonical record.

Guardrails:
- Preserve on-disk record shape exactly.
- Preserve deterministic ID behavior exactly.
- Do not widen this into a schema or API redesign.
- Do not touch unrelated core mutation files or docs unless the test forces it.
