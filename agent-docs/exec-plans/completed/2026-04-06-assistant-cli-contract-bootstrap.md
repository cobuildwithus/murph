## Goal (incl. success criteria):
- Compile a dense assistant-facing CLI contract automatically from `vault-cli --llms-full --format json`.
- Inject that contract into cold-start assistant system prompts so new provider threads stop relying on live CLI rediscovery.
- Keep the implementation fully automatic: CLI changes should flow through the compiled contract without manual command-family mapping or hand-maintained prompt lists.

## Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially the in-flight `assistant-cli-tools` split.
- Keep `murph.cli.run` as the execution surface; this task should not introduce new assistant tool types or command descriptors.
- Prefer prompt compilation over raw manifest injection so the bootstrap stays within a practical prompt budget.
- Reuse the existing cold-start bootstrap/session persistence seam instead of introducing a second continuity or caching layer.

## Key decisions:
- Use `--llms-full` as the single source for command descriptions and arg/option surfaces.
- Render a plain-text contract grouped automatically by command family, with terse per-command summaries and no manual allowlists.
- Exclude repeated global noise such as `vault` and `requestId`, and drop output-schema/example detail from the prompt contract.
- Inject the compiled contract through the system prompt on fresh provider threads while leaving resume behavior unchanged.

## State:
- ready_to_close

## Done:
- Read the repo routing, completion, and verification docs required for repo code work.
- Measured the raw `--llms-full` payload and confirmed it is far too large for direct prompt injection.
- Prototyped an automatic terse renderer against the real manifest and confirmed the all-command contract can fit within a small prompt budget.
- Confirmed the current bootstrap is injected as `continuityContext` only on cold starts, and the system prompt remains the better seam for the new contract.
- Implemented an automatic CLI contract compiler that groups commands by family, renders terse per-command summaries, and budgets the output size without hand-maintained family maps.
- Switched cold-start prompt injection from the old continuity summary path to a persisted system-prompt contract, while preserving resume behavior and read compatibility for previously stored `summary` values.
- Added a resilient manifest load path that prefers `--llms-full`, falls back automatically to compact `--llms` when the full manifest cannot be loaded, and avoids caching `null` bootstrap results across later sessions.
- Updated assistant-core prompt/contract tests and the CLI-facing cold-start tests to assert the new contract behavior.
- Verified the core source-level tests for the new prompt/compiler path with `pnpm exec vitest run --config vitest.config.ts test/system-prompt.test.ts test/assistant-user-facing-channel-prompt.test.ts test/assistant-cli-surface-summary.test.ts` in `packages/assistant-core`.
- Verified the contract loader directly from built assistant-core modules against a temporary vault and confirmed it persisted a `contract` state doc.
- Ran `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`; all three are currently blocked by pre-existing workspace failures rooted in `packages/assistant-core/src/model-harness.ts` and the resulting downstream missing-dist/type errors.

## Now:
- Close out the task with a scoped commit and handoff that calls out the unrelated workspace verification failures.

## Next:
- Fix the unrelated `packages/assistant-core/src/model-harness.ts` type errors so workspace builds and CLI package verification can run end-to-end again.

## Open questions (UNCONFIRMED if needed):
- Resolved: the persisted bootstrap doc now writes `contract` and still reads legacy `summary` values for compatibility.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-assistant-cli-contract-bootstrap.md`
- `packages/assistant-core/src/assistant/cli-surface-bootstrap.ts`
- `packages/assistant-core/src/assistant/system-prompt.ts`
- `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- `packages/assistant-core/src/assistant-cli-tools/execution-adapters.ts`
- `packages/assistant-core/test/assistant-cli-surface-summary.test.ts`
- `packages/cli/test/assistant-service.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
