Goal (incl. success criteria):
- Hard-cut remaining live compatibility/versioning baggage identified in the review so the repo reflects a clean greenfield/current-only posture.
- Success means legacy bridges are removed from live code, tests/docs are updated, verification passes, and the final diff does not preserve old-shape support merely for hypothetical prior deployments/data.

Constraints/Assumptions:
- User states there are no current deployments or persisted data.
- Preserve unrelated dirty worktree edits; overlapping hosted files must be integrated carefully.
- Healthy immutable `v1` schema ids and fail-closed version gates are not targets by themselves.

Key decisions:
- Use subagents only on disjoint write scopes.
- Keep local ownership for overlapping dirty hosted files: `apps/web/src/lib/hosted-wake/store.ts`, `apps/cloudflare/src/{runner-container,container-entrypoint}.ts`, `packages/hosted-execution/src/routes.ts`.
- Treat resilience/recovery logic separately from compatibility bridges; remove only if it is compatibility-only.

State:
- in_progress

Done:
- Loaded required workflow, security, reliability, verification docs.
- Completed parallel review and direct validation of the highest-signal compatibility seams.
- Registered active execution plan.
- Confirmed several originally flagged hosted hard-cut seams were already removed in the overlapping dirty tree.
- Landed a narrow assistant/provider compatibility follow-up:
  - kept provider normalization fail-safe for provider-less session-option shapes by routing `normalizeAssistantProviderConfig()` through a dedicated normalization helper
  - made a few operator-config test fixtures explicit about `provider` where the production contract already requires it

Now:
- Leave the broader greenfield hard-cut lane open and hand off the still-live remaining seams instead of forcing a wider runtime cut in this pass.

Next:
- Follow up on the still-open greenfield seams the review surfaced, especially:
  - hosted-execution parser legacy-field rejectors and other compatibility-flavored naming
  - the broader assistant provider/session-option contract if the repo wants a true explicit-provider hard cut end-to-end
- Coordinate any later commit/plan-closure step with the still-active broader lane.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the broader lane wants to hard-cut provider inference end-to-end, which would require changing assistant-engine/session-option contracts rather than only `operator-config`.

Working set (files/ids/commands):
- Plan: `agent-docs/exec-plans/active/2026-04-19-greenfield-hard-cut-compatibility.md`
- Ledger: `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Key files for the landed slice: `packages/operator-config/src/assistant/provider-config.ts`, `packages/operator-config/test/assistant-config-helpers.test.ts`
- Verification: `pnpm typecheck` (blocked by unrelated `apps/web` dirty-tree failure), targeted package Vitest runs for `packages/{operator-config,assistant-engine,hosted-execution}`, and `bash scripts/workspace-verify.sh test:diff ...` (surfaced unrelated dirty-tree `packages/cli/test/setup-cli.test.ts` failures)
