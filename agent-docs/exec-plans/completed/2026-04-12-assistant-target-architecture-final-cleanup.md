# Goal (incl. success criteria):
- Land the watched `assistant-target-architecture-final-cleanup.patch` semantics on top of the already-landed assistant target architecture refactor.
- Success means the assistant target/runtime seam keeps explicit preset-backed runtime identity, persists only the minimal resume state, correctly saves target changes from session option updates, and passes the repo-required scoped verification for the touched owners.

# Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially the active `packages/messaging-ingress/**` changes.
- Treat the downloaded patch as intent, not overwrite authority; adapt it to the current repo state where the assistant session schema is already hard-cut to `v1`.
- Keep the change scoped to the touched assistant/operator-config/CLI target area plus direct regression proof.

# Key decisions:
- Merge the cleanup semantically instead of replaying the patch literally because the repo already removed the patch's `v4`/`v5` session-schema compatibility seam.
- Hard-cut runtime identity resolution to explicit preset identity for OpenAI-compatible targets and remove base-URL/provider-name heuristics from the runtime resolver.
- Keep continuity safety in resolved provider options and clear stale provider bindings/resume state when session option changes alter the continuity fingerprint.

# State:
- in_progress

# Done:
- Read the required routing, verification, completion, and skill docs for this wake flow.
- Inspected the exported thread JSON and the downloaded cleanup patch.
- Confirmed the patch maps cleanly in principle, with semantic adaptation needed for the repo's newer `murph.assistant-session.v1` baseline.

# Now:
- Apply the cleanup changes across `packages/operator-config`, `packages/assistant-engine`, and `packages/cli`, then update the focused tests that still encode the older behavior.

# Next:
- Run scoped verification, send the same-thread attached-file review request, arm the final wake hop, and commit the exact touched paths.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the current package-level focused tests fully cover the session-option target-persistence fix, or whether one additional assistant-engine regression test will be needed.

# Working set (files/ids/commands):
- Files: `packages/operator-config/src/assistant/{provider-config.ts,target-runtime.ts}`, `packages/operator-config/src/{assistant-cli-contracts.ts,setup-cli-contracts.ts}`, `packages/assistant-engine/src/assistant/{local-service.ts,provider-binding.ts,provider-state.ts,providers/openai-compatible.ts,turn-finalizer.ts}`, `packages/cli/src/commands/model.ts`, targeted tests under `packages/operator-config/test/**`, `packages/assistant-engine/test/**`, `packages/cli/test/**`, this plan, and the coordination ledger.
- Commands: patch inspection with `git apply --check`, focused source reads with `sed`/`rg`, verification via `pnpm typecheck` and a truthful diff-aware or owner-coverage lane for the touched packages, plus the required same-thread `pnpm review:gpt --send ...` and `cobuild-review-gpt thread wake ...` follow-up commands.
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
