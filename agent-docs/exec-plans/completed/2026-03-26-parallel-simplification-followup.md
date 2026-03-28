# Parallel Simplification Follow-Up

Status: completed
Updated: 2026-03-28
Completed: 2026-03-28

## Goal

Run the remaining non-duplicative simplification/report tasks from the follow-up prompt batch via shared-worktree Codex workers, while skipping the already-completed hosted-web JSON helper refactor.

## Scope

- Finish the remaining `canonical-mutations.ts` cleanup by reusing `readValidatedFrontmatterDocument(...)` if the behavior stays identical.
- Dedupe `bank/providers.ts` against existing helpers in `domains/shared.ts` without broadening provider abstractions.
- Replace manual CLI list-envelope assembly with `asListEnvelope(...)` in the listed usecase files only.
- Deduplicate tiny device-provider normalization helpers in `packages/importers/src/device-providers/**`.
- Characterize the risky `protocols.ts` selector simplification candidate and report unless tests prove safe alignment.

## Explicit Deduped-Out Prompt

- Skip the hosted-web JSON/helper consolidation prompt because that work already landed in the prior seven-worker simplification batch.

## Constraints

- Shared current worktree only; keep worker lanes narrow and disjoint.
- Preserve existing exported behavior and user-visible error messages.
- For the risky `protocols.ts` task, default to characterization/reporting rather than behavior change.
- Preserve unrelated in-flight edits already present in the tree.

## Planned Files

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/worker-prompts/**`
- `packages/core/src/{canonical-mutations.ts,domains/shared.ts,bank/providers.ts,bank/protocols.ts}`
- `packages/core/test/{canonical-mutations-boundary.test.ts,core.test.ts,health-bank.test.ts}`
- `packages/cli/src/usecases/{shared.ts,document-meal-read.ts,experiment-journal-vault.ts,food.ts,integrated-services.ts,provider-event.ts,recipe.ts}`
- `packages/cli/test/{list-cursor-compat.test.ts,cli-expansion-document-meal.test.ts,cli-expansion-experiment-journal-vault.test.ts,cli-expansion-provider-event-samples.test.ts,health-tail.test.ts}`
- `packages/importers/src/device-providers/{shared-normalization.ts,oura.ts,whoop.ts,garmin-helpers.ts,garmin.ts}`
- `packages/importers/test/device-providers.test.ts`

## Execution Model

1. Register the batch in the coordination ledger.
2. Launch five Codex workers in the current worktree for the non-duplicate prompts.
3. Review/integrate worker results and keep the report-only `protocols.ts` lane non-destructive unless characterization tests justify more.
4. Run focused verification for changed files; keep repo-wide failures separate if they remain unrelated.

## Outcome

- Launched the narrowed follow-up worker batch after deduping out the already-landed hosted-web JSON helper task.
- Landed the remaining low-risk simplifications around shared list-envelope reuse and device-provider normalization while keeping the `protocols.ts` selector lane report-first.
- Folded the CLI food/recipe shared scaffolding cleanup into the same reuse sweep without widening into a generic CRUD framework.
