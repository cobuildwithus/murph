# App Server Thread Instructions

Goal:
Move stable Murph assistant instructions into Codex App Server thread-level
`baseInstructions` / `developerInstructions` when starting or resuming threads,
while keeping per-turn `turn/start` input focused on the current user turn and
preserving existing bootstrap/resume behavior.

Success criteria:
- `thread/start` and `thread/resume` include stable assistant instructions.
- `turn/start` no longer repeats those stable instructions when the thread
  instruction channel is available.
- Existing model/modelProvider/sandbox/approval request shaping remains intact.
- Focused app-server runtime tests cover the new payload shape.

Constraints:
- Preserve existing active work in adjacent assistant-engine files.
- Do not expose identifiers, secrets, prompts, transcripts, vault contents, or
  home paths in logs, fixtures, tests, docs, or final handoff.
- Keep changes scoped to Codex App Server request shaping and direct tests.

State:
- Implemented locally; focused assistant-engine verification passing; broader
  scoped verification and audits pending.

Done:
- Added `baseInstructions` / `developerInstructions` to Codex App Server
  thread context request shaping.
- Passed Murph `systemPrompt` as Codex `developerInstructions` from the Codex
  provider adapter.
- Kept `turn/start` prompt construction focused on conversation/user content by
  omitting `systemPrompt` from the flat turn prompt.
- Added focused assistant-engine coverage for thread request params and provider
  handoff behavior.
- Split planned Murph prompt layers so stable core/capability guidance flows to
  thread-level `developerInstructions`, while dynamic turn context stays in
  `turn/start` text with the user message.
- Added `excludeResumeTurns` as a Murph request option mapped only to Codex
  `thread/resume.excludeTurns`; no `baseInstructions` are populated by Murph.

Next:
- Run scoped typecheck/test-diff, completion audits, and scoped commit if the
  dirty overlapping worktree allows a safe commit.

Working outcomes:
- PASS: `pnpm --dir packages/assistant-engine typecheck`
- PASS: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/codex-thread-instructions.test.ts test/assistant-provider-final-coverage.test.ts`

Working set:
- `packages/assistant-engine/src/assistant-codex/app-server-requests.ts`
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/cli/test/assistant-codex.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
