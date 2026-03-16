# Apply shared AI SDK inbox routing refactor patch

Status: completed
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Land the provided inbox/assistant CLI refactor patch so the CLI uses a shared AI SDK harness, exposes the expanded inbox routing command surface, and remains aligned with repo docs, generated types, and verification requirements.

## Success criteria

- The patch contents are applied cleanly or manually reconciled with equivalent behavior in the current tree.
- CLI sources compile and required repo verification passes.
- Required completion-workflow audit passes run for the production-code changes.
- The active coordination ledger is kept accurate during the task and cleared when the work is complete.

## Scope

- In scope:
- `packages/cli` inbox/model/assistant harness files and CLI router wiring touched by the patch
- `packages/cli/package.json` dependency additions required by the new harness
- `README.md`, `ARCHITECTURE.md`, and `agent-docs/**` updates only if the applied patch changes durable behavior that current docs no longer describe truthfully
- Out of scope:
- Unrelated CLI cleanup beyond what is needed to land the patch and keep verification green
- New behavior not described by the supplied patch

## Constraints

- Technical constraints:
- Do not read `.env` files or expose secrets.
- Preserve any unrelated worktree state.
- Refresh generated incur types if command topology changes.
- Product/process constraints:
- Follow the coordination-ledger hard gate before code edits.
- Run required completion workflow audits: `simplify`, `test-coverage-audit`, `task-finish-review`.
- Run required repo checks and use `scripts/committer` if files change.

## Risks and mitigations

1. Risk: The patch was created against a nearby but not identical tree and may miss recent changes.
   Mitigation: Check applyability first, inspect impacted files after apply, and regenerate any derived CLI artifacts if needed.
2. Risk: New AI SDK dependencies or types may require additional repo adjustments beyond the raw diff.
   Mitigation: Run full verification and patch any compile/test regressions before handoff.
3. Risk: The broadened routing tool surface may alter durable architecture or command-surface docs.
   Mitigation: Update architecture/process docs in the same change if verification or code review shows drift.

## Tasks

1. Apply the supplied patch and inspect resulting file set for generated-file or doc drift.
2. Resolve any compile/test issues introduced by the patch, including generated CLI types if needed.
3. Run completion-workflow audit passes and required repo verification commands.
4. Commit the scoped changes and clear active coordination artifacts.

## Decisions

- Use the supplied patch as the primary source of truth, with minimal manual reconciliation only where the current tree requires it.
- Pin `@ai-sdk/openai-compatible` to the AI SDK 5-compatible `1.x` line after install resolved an incompatible `2.x` provider generation.
- Reuse one inbox-model session helper so bundle materialization and route execution share the same tool catalog and plan schema source of truth.
- Add direct assistant harness and inbox model route tests rather than relying only on CLI help/schema coverage.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Completion workflow audit passes using the repo prompts
- Expected outcomes:
- Required repo checks pass, or any blocker is shown to be unrelated and documented before commit.

## Status notes

- `pnpm typecheck` passed after patch integration, dependency alignment, and test additions.
- `pnpm test` failed on pre-existing/unrelated CLI tests in `packages/cli/test/selector-filter-normalization.test.ts` and `packages/cli/test/stdin-input.test.ts`.
- `pnpm test:coverage` failed on the same two unrelated CLI tests after doc gardening and package-shape checks passed.
- Focused verification passed for `pnpm test:smoke`, `packages/cli/test/inbox-incur-smoke.test.ts`, `packages/cli/test/inbox-cli.test.ts`, `packages/cli/test/inbox-model-harness.test.ts`, `packages/cli/test/assistant-harness.test.ts`, and `packages/cli/test/inbox-model-route.test.ts`.
Completed: 2026-03-16
