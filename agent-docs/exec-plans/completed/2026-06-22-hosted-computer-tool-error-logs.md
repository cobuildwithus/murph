# Hosted Computer Tool Error Logs

## Goal

Persist hosted computer tool failures such as `HOSTED_COMPUTER_EVAL_FAILED` into the existing `hosted_runtime_log` path so recurring browser automation failures are queryable after the turn.

## Constraints

- Keep `apps/web` as the hosted runtime log owner.
- Reuse the existing runtime log port; do not add a new table, queue, or scheduler.
- Keep logs metadata-only and compatible with hosted runtime redaction.
- Preserve richer model-facing tool error text, but persist only safe structured diagnostics.
- Preserve unrelated dirty work in the current checkout.

## Plan

1. Trace the hosted computer dynamic tool failure path and runtime log contract.
2. Reuse the existing `apps/web` hosted runtime log writer at the internal computer API boundary.
3. Emit one bounded warn/error runtime log for failed hosted computer API calls.
4. Add focused tests for route helper logging and runtime log contract acceptance.
5. Run scoped verification and completion audits.

## Verification

- `pnpm --dir apps/web test hosted-computer-runtime-log.test.ts`
- `pnpm --dir packages/hosted-execution test hosted-runtime-control.test.ts`
- `pnpm --dir apps/web exec eslint src/lib/computer-use/runtime-log.ts app/api/internal/computer/runs/route.ts 'app/api/internal/computer/runs/[runId]/act/route.ts' 'app/api/internal/computer/runs/[runId]/observe/route.ts' 'app/api/internal/computer/runs/[runId]/pause-for-user/route.ts' 'app/api/internal/computer/runs/[runId]/finish/route.ts' test/hosted-computer-runtime-log.test.ts`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir packages/hosted-execution typecheck`
- `git diff --check -- <task paths>`
- Security/privacy audit subagent: no medium-or-higher findings.
- Coverage-write subagent: added helper-boundary redaction/failure-mode proof; no production changes.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
