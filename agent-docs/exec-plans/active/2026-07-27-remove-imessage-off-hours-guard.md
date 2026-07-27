# Remove iMessage Off-Hours Reminder Guard

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let Murph save user-requested Linq/iMessage reminders at any local time without adding an off-hours spam warning, alternative-time suggestion, or extra confirmation.

## Success criteria

- The assistant prompt no longer contains the 11pm-5am Linq/iMessage reminder guard.
- The dedicated prompt regression is removed.
- Current deliverability guidance no longer treats recipient-local off-hours as a spam-risk scheduling instruction.
- Other pacing, line-health, consent, routing, and reminder-lifecycle safeguards remain unchanged.
- Canonical scoped verification and the required prompt/product review workflow pass.

## Scope

- In scope: the assistant automation prompt, its focused prompt test, current durable deliverability/product wording that specifically carries the off-hours spam rule, and the required durable-doc index metadata.
- Out of scope: scheduler mechanics, user-configured quiet hours, line-volume limits, line-health suppression, historical changelog entries, reminder routing, and automation lifecycle behavior.

## Constraints

- Delete the obsolete instruction instead of replacing it with another guard or state path.
- Preserve unrelated prompt work occurring in other isolated worktrees.
- Keep historical release and changelog records immutable as records of prior shipped behavior.

## Risks and mitigations

1. Risk: deleting broader reminder guidance could weaken unrelated deliverability protections.
   Mitigation: remove only recipient-local off-hours/spam-window wording and keep pacing, reciprocity, volume, line-health, and consent rules intact.
2. Risk: a durable doc reference could continue to imply the removed quiet-hours policy.
   Mitigation: search current prompts, tests, and live docs for the exact time window and off-hours framing after the edit.
3. Risk: overlapping prompt work could be overwritten.
   Mitigation: use an isolated task worktree and keep the diff limited to the exact prompt block and dedicated regression.

## Tasks

1. Remove the off-hours Linq/iMessage reminder prompt block and its dedicated regression.
2. Remove matching live deliverability and product-spec wording without altering historical records or user-configured quiet-hour semantics.
3. Run focused prompt proof and canonical `pnpm test:diff` verification.
4. Complete the required product-experience and preliminary ReviewGPT prompt/coverage reviews, then perform the parent final review.
5. Close the plan, commit the final scoped change, and hand off the open PR with CI and mergeability evidence.

## Decisions

- Treat the system-prompt block as the proven root cause; no scheduler change is needed because the scheduler already supports midnight reminders.
- Preserve historical changelog and release-note entries as records of the feature that is now being removed.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/model-behavior.test.ts --no-coverage`: passed, 67 tests.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts --no-coverage -t 'processes a canonical daily-local midnight job when runtime state is missing'`: passed, 1 test with 145 skipped by the name filter. This exercises an existing Linq daily-local `00:00` job through due evaluation and queued delivery.
- `pnpm docs:drift`: passed after refreshing the durable-doc index dates.
- `pnpm test:diff <task paths>`:
  - The local run passed all affected typechecks, the complete assistant-engine suite (177 files passed, 1 skipped; 2,748 tests passed, 6 skipped), and the assistant CLI, runtime, and daemon suites before unrelated CLI tests timed out under shared-host contention.
  - The forced Crabbox rerun independently passed the same affected typechecks and complete assistant-engine suite, then reproduced broad 60-second timeouts across untouched CLI expansion, assistant, and import-surface tests. It also reported unrelated experiment-protocol expectation failures. The task-owned run was stopped after the failures were established rather than waiting through every repeated timeout.
  - No task diff touches `packages/cli`; the changed owner suite and focused regression remain green. The reverse-dependent CLI lane is a pre-existing base blocker, not evidence against this prompt deletion.
- Product-experience review: `NO FINDINGS`. The reviewer confirmed that `00:00` is already valid through the schedule contract and runtime and that deleting only the prompt detour is the smallest complete experience. The remaining evidence gap is a live model/tool scenario proving the nondeterministic model immediately chooses the automation tool; the prompt contract and production midnight runtime path are covered locally.
