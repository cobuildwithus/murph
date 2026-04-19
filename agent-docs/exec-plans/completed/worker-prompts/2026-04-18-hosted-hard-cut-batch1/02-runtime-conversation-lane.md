You are worker 2 for the hosted hard-cut migration batch. You are not alone in
the codebase. Work carefully on top of the current tree, do not revert other
changes, and adjust to nearby edits instead of overwriting them.

Read first:

- `AGENTS.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-18-hosted-hard-cut-migration.md`
- `docs/hosted-hard-cut-migration-guide.md`

Goal:

- Finish the runtime conversation-vs-system split so ordinary message wakes no
  longer force the generic hosted maintenance loop after every turn.

Write scope:

- `packages/assistant-runtime/src/hosted-runtime/{execution,events,models,summary}.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/**`
- focused `packages/assistant-runtime/test/**`

Do not touch:

- `apps/web/**`
- `apps/cloudflare/**`
- broad shared hosted-execution contract/vocabulary renames

Context from the live tree:

- `events.ts` already branches message wakes vs system wakes.
- `execution.ts` still always calls `runHostedMaintenanceLoop(...)` after
  `executeHostedDispatchEvent(...)`.
- The migration guide treats this as a remaining hot-path coupling bug, not a
  missing architecture from scratch.

Implementation target:

- Message wakes should run the capture/conversation lane only.
- System wakes keep explicit system handlers and may still run maintenance where
  appropriate.
- Preserve current activation/share/device-sync behavior unless a targeted test
  proves a required adjustment.

Constraints:

- Keep the current dispatch contract in this lane; do not widen into the shared
  hosted-execution contract hard cut.
- Provider-specific Linq/Telegram/Email modules should remain message
  normalization helpers, not lifecycle entrypoints.
- Preserve snapshot and side-effect safety guarantees.

Verification:

- Run the highest-signal focused assistant-runtime tests you touch.
- If practical, run `pnpm --dir packages/assistant-runtime test:coverage`.
- Otherwise run targeted Vitest commands and report exactly what you covered.

Final response format:

- summary of what changed
- exact files changed
- verification run and outcomes
- any blockers or follow-up risks
