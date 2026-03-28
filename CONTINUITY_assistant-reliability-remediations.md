Goal (incl. success criteria):
- Fix the reported assistant reliability bugs with durable session writes, failover error/eligibility handling, transcript-aware session restore, and failed auto-reply prompt persistence.

Constraints/Assumptions:
- Narrow lane in overlapping assistant files, especially `service.ts`.
- Keep transcript-backed provider replay correct; do not silently restore session-only state for providers that require local transcript history.

Key decisions:
- Use the shared assistant runtime write lock for session/index mutation paths instead of introducing a new lock.
- Preserve failed auto-reply prompts as non-conversation transcript attempt records so replay semantics stay unchanged.

State:
- ready_to_commit

Done:
- Read repo routing/runtime docs, active coordination ledger, and the relevant assistant persistence/failover/runtime files.
- Registered the active coding lane and added an execution plan.
- Implemented runtime-write-lock coverage for session/index writes plus transcript-aware session snapshot restore.
- Updated failover/error handling to keep terminal provider context and honor structured retryability/interruption traits.
- Added focused assistant regressions covering lock enforcement, transcript-backed restore, interrupted/no-failover handling, and failed auto-reply prompt persistence.
- Focused verification passed:
  `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts`
- Mandatory audit subagents completed. The final review caught and the implementation fixed the explicit empty-transcript restore case.

Now:
- Remove the ledger row, commit the scoped assistant reliability follow-up, and hand off with blocked repo-wide checks called out explicitly.

Next:
- None after commit beyond user follow-up.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any non-Ink caller relies on session-only restore for an openai-compatible session. Current plan is to fail closed there.
- UNCONFIRMED: whether the unrelated repo-wide verification failures in `packages/contracts`, `packages/parsers`, and `packages/cli/src/assistant/canonical-write-guard.ts` are being fixed in another active lane.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-28-assistant-reliability-remediations.md`
- `packages/cli/src/assistant/{failover.ts,provider-state.ts,provider-turn-recovery.ts,service.ts,store.ts,store/persistence.ts}`
- `packages/cli/src/assistant-cli-contracts.ts`
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/test/{assistant-state.test.ts,assistant-service.test.ts,assistant-runtime.test.ts}`
- `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts`
- `pnpm typecheck` -> unrelated failures in `packages/cli/src/assistant/canonical-write-guard.ts`, then `packages/parsers/dist` ENOTEMPTY
- `pnpm test` -> unrelated `packages/contracts/dist` ENOTEMPTY
- `pnpm test:coverage` -> unrelated missing exports in `packages/contracts/scripts/verify.ts`
