Goal (incl. success criteria):
- Stop assistant runtime audit/status/error rows from replaying as user-authored model history.
- Success: transcript replay includes only real user and delivered assistant messages; runtime diagnostics remain available through out-of-band issue/trace paths and tests enforce the boundary.

Constraints/Assumptions:
- Keep the change narrow to assistant-engine replay behavior and direct tests.
- Preserve active prompt-cache and hosted assistant work in the shared checkout.
- Do not log or fixture real contact identifiers, secrets, local paths, or personal identifiers.

Key decisions:
- Treat runtime audits as observability residue, not conversation memory.
- Keep current same-turn AI SDK tool result handling unchanged; recoverable tool failures already flow back through tool results.

State:
- Implementation complete; closing without a scoped commit because overlapping dirty ledger edits make a safe plan-bearing commit unsafe.

Done:
- Reviewed Murph replay flow and local Codex tool-error flow.
- Confirmed private runtime issue capture already exists for tool failures.
- Removed runtime-audit replay as user-authored conversation history.
- Removed the dead audit-for-replay formatter.
- Updated transcript replay tests for conversation-only replay.
- Verification: focused transcript-audit Vitest passed, package typecheck passed, package coverage executed all assistant-engine tests successfully but failed unrelated global branch thresholds, and repo typecheck/test:diff remain blocked by unrelated active-tree failures.
- Required audits: security/privacy review, coverage-write, and task-finish-review completed with no requested changes.

Now:
- Close the active plan and hand off.

Next:
- None for this slice.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- `packages/assistant-engine/src/assistant/transcript-audit.ts`
- `packages/assistant-engine/test/assistant-transcript-audit.test.ts`
- `agent-docs/exec-plans/completed/2026-04-26-assistant-transcript-audit-replay-cleanup.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
