# Remove stale assistant guard/workspace seams

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Remove the stale canonical-write-guard and provider-workspace seams that no longer participate in assistant turn execution so the live code, tests, and durable docs describe only the current privileged-local assistant model.

## Success criteria

- `packages/assistant-core` and CLI assistant flows no longer carry dead canonical-write-block/provider-workspace runtime branches.
- Focused tests and durable docs stop describing the removed guard/workspace model as an active assistant safety boundary.
- Required verification for the touched assistant surfaces passes, or any unrelated blocker is named explicitly with focused proof.

## Scope

- In scope:
- Delete unused assistant-core guard/workspace helpers and stale result-contract handling tied only to that removed path.
- Update assistant runtime/UI/failover code so removed guard-specific branches become ordinary failure handling or disappear.
- Remove or rewrite focused tests and durable docs that still describe the old guard/workspace story as current behavior.
- Out of scope:
- Reworking unrelated assistant backend/config cleanup already active elsewhere in the tree.
- Editing immutable completed execution plans or historical release notes/changelog snapshots unless a durable workflow guard requires it.

## Constraints

- Technical constraints:
- Preserve unrelated in-flight assistant edits and keep this cleanup limited to dead seams and the contracts they forced downstream.
- Avoid introducing a new compatibility shim for a path the runtime no longer uses.
- Product/process constraints:
- Follow repo completion workflow: focused verification, required final review audit, then scoped commit through `scripts/finish-task`.
- Update durable docs that currently describe the removed guard/workspace boundary.

## Risks and mitigations

1. Risk: removing the stale blocked-result contract could accidentally break remaining assistant UI/automation paths that still branch on it.
   Mitigation: trace every `blocked` and guard-specific reference first, then simplify the shared result/UI flow in one patch and cover it with focused assistant tests.
2. Risk: durable docs may drift if the cleanup only lands in code.
   Mitigation: update `ARCHITECTURE.md` and `agent-docs/SECURITY.md` in the same change and rely on repo docs drift checks.

## Tasks

1. Register the cleanup scope in the coordination ledger and inspect every remaining guard/workspace reference.
2. Remove dead assistant-core helper files and simplify the active assistant result/failover/UI flow to match the current runtime.
3. Delete or rewrite focused tests and durable docs that still describe the removed path.
4. Run required verification, complete the required final-review audit, address any findings, and finish with a scoped commit.

## Decisions

- Treat the old canonical-write-block result path as fully removed rather than preserving a dead compatibility branch in the live assistant turn runner.
- Keep legacy blocked turn receipts/status snapshots readable on disk so upgrades do not quarantine or drop historical assistant-state artifacts, even though the live runtime no longer emits that path.
- Leave immutable completed execution-plan snapshots and historical release notes alone unless verification tooling requires otherwise.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Repo-required assistant/docs verification should pass; if an unrelated pre-existing failure blocks the full baseline, record the exact failing command and run the highest-signal focused proof available for the touched assistant surfaces.
- Results:
- `pnpm typecheck` remains red in unrelated active assistant backend-target/config files: `packages/assistant-core/src/assistant/{service-turn-routes.ts,session-resolution.ts}` and `packages/cli/src/setup-services.ts`.
- Focused proof passed:
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-service.test.ts -t "sendAssistantMessage does not fail over on interrupted provider errors that mark themselves non-retryable|sendAssistantMessage preserves the primary provider error for tool-bound openai-compatible failover exhaustion"`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-runtime.test.ts -t "scanAssistantAutoReplyOnce records provider quota failures with a safe summary|assistant Ink queued prompt disposition replays completed follow-ups and restores interrupted or failed queues|assistant Ink view-model merges streaming trace updates by stream key"`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-observability.test.ts -t "assistant observability still reads legacy blocked turn receipts and status snapshots"`
- `git diff --check`
Completed: 2026-04-02
