# Goal (incl. success criteria):
- Land the watched `assistant-target-prod-review-final.patch` semantics on top of the already-landed assistant target refactor/final-cleanup work.
- Success means the remaining target/runtime gaps are closed without replaying stale hunks: OpenAI-compatible runtime behavior is resolved from explicit preset-backed behavior, unsupported zero-data-retention cannot persist into runtime session options, and focused regression tests cover the retained session-target persistence fix plus the operator-config runtime rules.

# Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially the active `packages/messaging-ingress/**` changes.
- Treat the downloaded patch as intent, not overwrite authority; `packages/assistant-engine/src/assistant/local-service.ts` already contains the intended target-merge fix and should not be overwritten.
- Keep the change scoped to the assistant target/runtime area plus direct regression proof.

# Key decisions:
- Land only the still-applicable hunks from the downloaded artifact instead of applying it wholesale.
- Reuse the existing `assistant-local-service-runtime.test.ts` coverage surface for the persisted-target regression instead of introducing a new adjacent test file.
- Keep unlabeled OpenAI-compatible endpoints conservative and gate zero-data-retention from persisted config through runtime serialization.

# State:
- completed

# Done:
- Read the required routing, verification, completion, and `work-with-pro` docs for this wake flow.
- Inspected the exported ChatGPT thread JSON and the downloaded `assistant-target-prod-review-final.patch`.
- Compared the artifact against the live target-area files and confirmed the `local-service` fix was already present while operator-config/runtime gaps remained.
- Landed the still-applicable operator-config/runtime changes plus focused regression updates for explicit gateway preset persistence.
- Verified the touched slice with `pnpm --dir packages/operator-config typecheck`, `pnpm --dir packages/operator-config test:coverage`, `pnpm --dir packages/assistant-engine typecheck`, a targeted `assistant-local-service-runtime` Vitest run, and direct `tsx` runtime proof.

# Now:
- Close the active plan through the scoped commit flow.

# Next:
- None.

# Open questions (UNCONFIRMED if needed):
- Repo-required root checks are still blocked by pre-existing assistant-session fixture drift outside this patch in `packages/assistantd/**` and `packages/assistant-cli/**`.

# Working set (files/ids/commands):
- Files: `packages/operator-config/src/assistant/{target-runtime.ts,provider-config.ts}`, `packages/operator-config/src/assistant-cli-contracts.ts`, `packages/operator-config/test/{assistant-provider-config.test.ts,assistant-seam-coverage.test.ts,hosted-assistant-bootstrap.test.ts}`, this plan, and the coordination ledger.
- Commands: source inspection with `sed`/`rg`, repo-required verification via `pnpm typecheck` and `pnpm test:diff packages/operator-config`, focused proof via `pnpm --dir packages/operator-config typecheck`, `pnpm --dir packages/operator-config test:coverage`, `pnpm --dir packages/assistant-engine typecheck`, `pnpm exec vitest run --config vitest.config.ts test/assistant-local-service-runtime.test.ts`, direct `tsx` runtime proof, and `scripts/finish-task` for the scoped commit.
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
