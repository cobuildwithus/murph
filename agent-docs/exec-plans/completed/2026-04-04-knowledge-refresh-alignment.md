# Knowledge Refresh Alignment Plan

## Goal

Make the knowledge workflow consistent across runtime behavior and agent-facing guidance by preferring refresh of existing pages, tightening `--source-path` wording, and fixing refresh compile semantics so reused source metadata matches the actual compile context.

## Scope

- Update assistant prompt/help guidance to tell the agent to search/show first and prefer refreshing an existing slug over creating near-duplicate pages.
- Tighten knowledge CLI descriptions so `--source-path` explicitly means vault-relative paths or absolute paths that still resolve inside the selected vault.
- Change knowledge compile refresh behavior to compile from the union of existing and explicitly provided source paths.
- Add focused regression coverage for the refresh-source behavior and any nearby command/help expectations touched by the change.

## Constraints

- Keep the change narrow to the derived knowledge workflow.
- Preserve the current rejection of derived/runtime source inputs such as `derived/**`, `.runtime/**`, and `assistant-state/**`.
- Do not expose machine-local personal identifiers in prompts, tests, docs, or commit output.
- Preserve unrelated worktree edits if the tree changes while this task is in flight.

## Verification

- `pnpm --dir packages/assistant-core typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/knowledge-runtime.test.ts packages/cli/test/incur-smoke.test.ts --coverage.enabled=false --maxWorkers 1`

## Outcome

## Verification Results

- `pnpm install --frozen-lockfile` succeeded after `pnpm` initially reported `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`.
- `pnpm --dir packages/assistant-core typecheck` succeeded.
- `pnpm --dir packages/cli typecheck` succeeded.
- `pnpm --dir packages/cli build` succeeded so the built CLI schema test read the refreshed command metadata.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/knowledge-runtime.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/assistant-cli-access.test.ts --coverage.enabled=false --maxWorkers 1` succeeded.

Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
Completed: 2026-04-04
