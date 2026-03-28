You are Codex Worker F1 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker F1` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch scoped to `packages/core/src/canonical-mutations.ts` plus directly necessary tests only.
- This lane is a follow-up to an already-landed dead-code prune. Do not redo the prior cleanup; focus only on what remains.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers, and whether anything was reported instead of applied.

Task:

Do a behavior-preserving cleanup of `packages/core/src/canonical-mutations.ts`.

Why this matters:
`public-mutations.ts` only imports `promoteInboxJournal` and `promoteInboxExperimentNote`, and this file only exports those two functions. A prior simplification pass removed the obvious stale mutation cluster, but the file still carries a local frontmatter-reader clone (`safeParseDocument`, `readExperimentFrontmatterDocument`, `readJournalDayFrontmatterDocument`) even though `packages/core/src/domains/shared.ts` already exports `readValidatedFrontmatterDocument(...)`.

Best-guess fix:
- Keep the file in place; do not rename or move it.
- Replace the local frontmatter-reader clone with `readValidatedFrontmatterDocument(...)` from `packages/core/src/domains/shared.ts` if and only if the exact error behavior/messages stay identical.
- Narrow imports to what the two live promotion functions actually use.
- Preserve exact `HB_EXPERIMENT_FRONTMATTER_INVALID` / `HB_JOURNAL_FRONTMATTER_INVALID` messages.
- Report, don’t apply, any larger rename/split of `canonical-mutations.ts`.

Regression anchors:
- `packages/core/test/canonical-mutations-boundary.test.ts`
- `packages/core/test/core.test.ts`

