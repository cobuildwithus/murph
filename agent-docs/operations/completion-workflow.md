# Completion Workflow

Last verified: 2026-03-28

This workflow applies to repo code/docs/test/config changes.
Vault-only data tasks under `vault/**` skip this workflow unless the user explicitly asks for repo/process work.

## Sequence

1. Complete functional implementation first.
2. Run a scope/shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, and any architecture/API/trust-boundary change is documented or split into an explicit plan.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Spawn a dedicated audit subagent for the simplification pass and hand it `agent-docs/prompts/simplify.md` plus the audit handoff packet below. Expect this audit to take about 5 to 10 minutes on non-trivial diffs; do not rush it or cancel it early just because it has not answered in the first minute.
5. Apply behavior-preserving simplifications, with explicit attention to missed existing helpers, duplicated logic, and abstractions that do not earn their keep immediately.
6. Spawn a dedicated audit subagent for the test-coverage pass and hand it `agent-docs/prompts/test-coverage-audit.md` plus the audit handoff packet below. Expect this audit to take about 5 to 10 minutes on non-trivial diffs; do not rush it or cancel it early just because it has not answered in the first minute.
7. Implement the highest-impact missing tests identified by the coverage pass when a real test harness exists, prioritizing proof at the highest stable behavior boundary available instead of only helper-level or snapshot coverage.
8. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence. Examples: built CLI command, focused manual flow, browser inspection, or a narrow end-to-end path.
9. Re-run required checks after simplify + coverage updates.
10. Spawn a dedicated audit subagent for the final completion review and hand it `agent-docs/prompts/task-finish-review.md` plus the audit handoff packet below. Expect this audit to take about 5 to 10 minutes on non-trivial diffs; do not rush it or cancel it early just because it has not answered in the first minute.
11. Resolve high-severity findings before final handoff.
12. If the task used an active execution plan and the task is done or abandoned, close that plan before commit or handoff. Prefer `bash scripts/finish-task <active-plan-path> "type(scope): summary" <file> [file ...]` when the task is ready to commit.
13. Final handoff must report required-check results plus any direct scenario evidence; green required checks remain the default completion bar.
14. If a required check fails for a credibly unrelated pre-existing reason, commit your exact touched files and hand off with the failing command, failing target, and why your diff did not cause it. If you cannot defend that separation, treat the failure as blocking.

## Required Audit Delegation

- The three named audit passes are mandatory subagent work, not optional self-review.
- Use explicitly spawned subagents for `simplify`, `test-coverage-audit`, and `task-finish-review`.
- Treat the main implementation agent as the integrator of audit findings, not the auditor of record.
- Within this repo, those three mandatory audit passes are standing-authorized by repo policy. When the current environment supports spawned agents, run them without stopping only to ask for separate delegation permission.
- Use a fresh subagent per pass unless the user explicitly instructs otherwise.
- When waiting on these audit subagents, prefer a patient wait window over repeated short polling. A realistic default is 5 to 10 minutes for each pass on medium or large diffs.
- Do not cancel or close an audit subagent early just because it has been running for under 10 minutes unless you have concrete evidence that it is stuck or operating on the wrong scope.
- If subagent tooling is unavailable in the current environment, stop and escalate instead of silently downgrading the audit requirement to local review.

## Coordination Ledger (Repo Code Only)

- Before repo coding work, add an active row to `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Treat the row as an active-work notice by default, not a hard lock.
- Overlap is allowed when agents stay within their declared scope, read the current file state first, and preserve adjacent edits.
- Mark a row as exclusive in `Notes` only when overlap is unsafe, such as a broad refactor or a delicate cross-cutting rewrite.
- Update the row if file scope, symbol intent, or exclusivity expectations change.
- Remove the row immediately when the task is complete or abandoned.
- Vault-only data tasks do not use the coordination ledger.

## Vault-Only Data Tasks

- Limit writes to `vault/**` plus the canonical audit or runtime artifacts produced by the invoked mutation path.
- Do not edit repo docs, execution plans, or package source just to satisfy a vault logging request.
- Do not run repo-wide verification commands by default.
- Capture direct proof by reading back the touched records and audit or ledger entries.

## Audit Handoff Packet

For each required audit subagent, provide:

- What changed and why (behavior-level summary).
- Why the chosen implementation fits the existing system, especially when it introduces or extends abstractions.
- Invariants/assumptions that must still hold.
- Links to active execution plans (when present).
- Verification evidence already run (commands + outcomes).
- Any direct scenario proof already run, or the gap if it still needs human verification.
- Current worktree context and explicit review boundaries.
- Instruction to read `COORDINATION_LEDGER.md`, honor any explicit exclusive/refactor notes, and otherwise work carefully on top of overlapping rows.

## Safety Rules

- Do not overwrite, discard, or revert unrelated worktree edits.
- Do not use reset/checkout cleanup commands to prepare audit passes.
- If an audit suggestion conflicts with pre-existing edits, leave the file untouched and escalate in handoff notes.
- Treat "green checks" as necessary but not sufficient when the changed behavior has a user-visible or operational boundary; require direct proof or call out the missing proof explicitly.
