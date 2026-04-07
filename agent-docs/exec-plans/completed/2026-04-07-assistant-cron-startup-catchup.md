# Trace and fix assistant cron startup catch-up for recurring food autolog

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Determine whether due recurring food autolog jobs are missed when `assistant run` starts after the scheduled time, and land the smallest fix plus regression proof if the startup path is broken.

## Success criteria

- The startup path for `runAssistantAutomation` is traced end to end for due cron work.
- There is a deterministic focused test covering a due recurring food autolog job when the automation loop starts after the scheduled time.
- If the startup path is broken, the minimal code fix lands without changing the intended “only while `assistant run` is active” product boundary.
- Verification shows the due job is processed on startup through the real automation loop seam rather than only through the lower-level cron helper.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/**`
- `packages/cli/test/assistant-robustness.test.ts`
- focused assistant cron/runtime helpers or tests needed to reproduce and fix the startup behavior
- Out of scope:
- redesigning assistant scheduling semantics beyond startup catch-up for already-due jobs
- changing hosted execution behavior
- broader automation UX or messaging cleanup unless required to keep docs truthful for the landed behavior

## Constraints

- Technical constraints:
- Preserve current scheduling ownership: recurring food autolog still runs only through the assistant automation loop, not via chat-only surfaces.
- Preserve unrelated dirty worktree edits, including pre-existing changes outside this assistant cron/runtime lane.
- Keep the fix narrow and avoid speculative scheduler refactors.
- Product/process constraints:
- This touches cron/startup/reliability behavior, so direct proof is required in addition to scripted tests.

## Risks and mitigations

1. Risk: the lower-level cron helper works, but the top-level automation loop never reaches it in the relevant startup mode.
   Mitigation: reproduce through `runAssistantAutomation({ once: true, startDaemon: false })`, not only through `processDueAssistantCronJobs`.

2. Risk: the issue is user-path confusion between `assistant run` and chat/other assistant surfaces.
   Mitigation: keep the test and final conclusion anchored to the exact `assistant run` seam and current product copy.

3. Risk: a fix accidentally changes recurring schedule semantics after successful runs.
   Mitigation: keep the patch limited to startup catch-up handling and reuse existing cron finalization logic.

## Tasks

1. Inspect the existing `runAssistantAutomation` and cron tests for startup behavior and due-job coverage gaps.
2. Reproduce the startup catch-up path with a focused recurring food autolog scenario.
3. Fix the startup path only if the repro shows a real bug.
4. Add focused regression coverage for the due-on-start recurring food case.
5. Run required verification, capture direct scenario proof, then complete audit and commit workflow.

## Decisions

- Trace through the real local automation loop seam first, because lower-level due-job processing already has some coverage.
- The startup catch-up path works as designed for `assistant run`; the likely user-facing confusion is between the always-on automation loop and other assistant entrypoints such as chat.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm exec vitest run packages/cli/test/assistant-robustness.test.ts -t "runAssistantAutomation processes due recurring food autolog jobs on startup" --no-coverage`
- Expected outcomes:
- Focused assistant runtime/cron tests pass, including a startup catch-up regression around due recurring food autolog work.
- Actual outcomes:
- `pnpm exec vitest run packages/cli/test/assistant-robustness.test.ts -t "runAssistantAutomation processes due recurring food autolog jobs on startup" --no-coverage` passed.
- A broader assistant-runtime suite rerun is currently blocked by unrelated dirty-worktree failures rooted in `packages/assistant-engine/src/assistant/provider-turn-runner.ts`.
- `pnpm typecheck` failed for unrelated pre-existing issues in `packages/core/src/vault.ts`, `packages/hosted-execution/src/outbox-payload.ts`, and unrelated `packages/assistant-engine/src/usecases/{integrated-services,workout-measurement,workout-model}.ts`.
Completed: 2026-04-07
