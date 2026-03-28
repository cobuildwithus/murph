You are Codex Worker W3 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `AGENTS.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Use the pre-registered ledger row `codex-worker-history-normalizers`; update it if scope shifts, and remove it before finishing.
- Keep this behavior-preserving: do not change the canonical event contract, default field values, or read/write semantics.

After changes:
- Run the narrowest truthful tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Simplify `packages/core/src/history/api.ts` by replacing the cast-heavy generic field-definition machinery with explicit per-kind normalizers.

Relevant files/symbols:
- `packages/core/src/history/api.ts`
  - `HistoryFieldDefinition`
  - `HISTORY_KIND_DEFINITIONS`
  - `normalizeTestHistoryFields`
  - `normalizeHistoryKindFields`
  - `buildHistoryEventRecord`
  - `parseStoredHistoryEvent`
  - `appendHistoryEvent`
  - `appendBloodTest`

Regression anchors to preserve:
- `packages/core/test/health-history-family.test.ts`
  - canonical append/list flows
  - test-event normalization alias handling
  - blood-test inferred status/analyte persistence
  - provider-id and raw-ref contract rejection

Best-guess fix:
1. Replace `HISTORY_KIND_DEFINITIONS` plus `HistoryFieldDefinition<unknown>` with explicit subtype normalizers.
2. If build-vs-parse differences are real, pass only the narrow config needed instead of a generic `mode` through every field.
3. Keep `normalizeBaseEvent` and the final `safeParseContract(...)` validation intact.

Overlap notes:
- Keep the change tightly scoped to `packages/core/src/history/api.ts` and direct tests. Do not widen into unrelated history consumers unless a tiny compatibility edit is required.
