# Assistant prompt triage

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Reduce unnecessary first-turn assistant latency by steering Healthy Bob chat toward the narrowest CLI discovery path that answers the user, instead of encouraging broad manifest reads by default.

## Success criteria

- The first-turn assistant prompt still advertises `vault-cli` and `healthybob` correctly.
- Prompt guidance explicitly prefers `vault-cli <command> --help` for syntax/examples.
- Prompt guidance limits `vault-cli <command> --schema --format json` to exact contract/shape inspection.
- Prompt guidance reserves `vault-cli --llms` / `--llms-full` for broad CLI discovery only.
- Focused tests lock the new prompt text and required repo checks are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant-cli-access.ts`
- `packages/cli/src/assistant/service.ts`
- focused prompt tests in `packages/cli/test/{assistant-cli-access,assistant-service}.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- changing assistant session persistence
- changing Codex subprocess behavior
- changing Ink chat UI behavior
- changing the CLI command graph or `--llms` output itself

## Constraints

- Preserve the existing PATH/setup guidance for `vault-cli` and `healthybob`.
- Keep the change behaviorally narrow to prompt wording and first-turn guidance.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: prompt simplification could make the model guess command shapes more often.
   Mitigation: keep per-command `--schema --format json` guidance for exact contracts and keep broad `--llms` as an escalation path.
2. Risk: prompt wording could drift from actual CLI behavior.
   Mitigation: align the new guidance with the existing built CLI help/schema surfaces and cover it with focused tests.
3. Risk: overlapping assistant work in the same files could create merge noise.
   Mitigation: keep the change small, preserve adjacent edits, and touch only the prompt helpers/tests needed for this triage.

## Tasks

1. Update the first-turn assistant CLI guidance to use a help-first discovery ladder.
2. Add any small top-level prompt wording needed to discourage broad vault/CLI reads when the task is narrow.
3. Update focused assistant prompt tests.
4. Run required checks and record outcomes.

## Decisions

- Healthy Bob chat should still discover CLI semantics from the CLI itself, but it should escalate from `--help` to `--schema` to `--llms` rather than starting broad.
- The first-turn system prompt is the right place for this change because the current slowdown appears during bootstrap turns.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-cli-access.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant prompt tests pass
- full required checks either pass or surface unrelated pre-existing failures that will be recorded explicitly
Completed: 2026-03-18
