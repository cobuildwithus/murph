# Experiment Protocol Default

## Goal

Make Murph's experiment creation path default to Health Commons protocol-backed runs when a relevant public protocol is available, and make the CLI harder to misuse for accidental private/custom runs.

## Constraints

- Preserve private runs as a fallback only when no matching public protocol is available or the operator explicitly chooses the custom path.
- Keep private user run data private; only the public protocol reference and exact revisions should attach to the private run.
- Follow the existing `packages/core` canonical write boundary through `packages/vault-usecases`.
- Do not expose local paths, account names, secrets, raw health data, or personal identifiers in docs, tests, prompts, or command output.

## Plan

1. Locate the assistant prompt/tool guidance and CLI experiment command path.
2. Add a protocol-first assistant instruction and a hard validation/defaulting rule in the typed plan path.
3. Adjust CLI help/error language so custom/private creation is clearly the fallback path.
4. Add focused coverage for the behavior and run the required verification lane.

## Verification

- Passed: `pnpm --dir packages/cli gen:config-schema`
- Passed: `pnpm typecheck`
- Passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- Passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/cli/test/cli-expansion-experiment-journal-vault.test.ts packages/cli/test/cli-expansion-intervention.test.ts packages/cli/test/experiment-session-typed-confounders.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/stdin-input.test.ts`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/model-behavior.test.ts`
- Blocked by unrelated Cloudflare/source-audit work: `pnpm test:diff <changed paths>` passed the targeted CLI/assistant portions, then failed in `packages/cli/test/canonical-write-source-audit.test.ts` because `apps/cloudflare/src/container-entrypoint.ts` was reported as a non-core canonical mutator outside this task scope.
- Completed: `security-privacy-review`, `coverage-write`, and `task-finish-review` audit passes. Security and final-review findings were fixed with explicit current-argv fallback checks and config-default regressions.

## State

- Implementation and focused verification complete. Ready for scoped finish-task commit, preserving unrelated Cloudflare/Linq worktree edits.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
