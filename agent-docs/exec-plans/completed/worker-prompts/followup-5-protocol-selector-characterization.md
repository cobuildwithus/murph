You are Codex Worker F5 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker F5` with this lane's files/symbols and mark it `in_progress`.
- Treat this as a characterization/report-first task.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: findings first, then summary/tests/blockers. Be explicit if the correct outcome is “report only”.

Task:

Investigate the risky simplification candidate in `packages/core/src/bank/protocols.ts`, but do not unify the selector paths unless characterization tests prove behavior and you can defend the change as behavior-preserving.

Target:
- `selectProtocolRecord(...)` vs `resolveProtocolRecord(...)`

Best-guess next step:
- Add characterization tests in `packages/core/test/health-bank.test.ts` for:
  1. conflicting `protocolId` + `slug` on read
  2. ambiguous slug across groups on read
  3. ambiguous slug across groups on upsert
- After tests are in place, either leave code as-is and report that simplification would be behavior-changing, or proceed only if the behavior/messages already match.

Guardrails:
- Reporting is a valid outcome.
- Do not directly reuse `selectProtocolRecord(...)` inside `resolveProtocolRecord(...)` unless characterization proves no externally visible change.
