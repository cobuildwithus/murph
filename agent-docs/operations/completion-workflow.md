# Completion Workflow

Last verified: 2026-03-26

## Sequence

1. Complete functional implementation first.
2. Run a scope/shape check before polish: confirm the diff is still proportional to the task, new abstractions are immediately justified, and any architecture/API/trust-boundary change is documented or split into an explicit plan.
3. If the change sprawled, duplicated existing patterns, or introduced speculative structure, cut it back before continuing.
4. Run simplification pass using `agent-docs/prompts/simplify.md`.
5. Apply behavior-preserving simplifications, with explicit attention to missed existing helpers, duplicated logic, and abstractions that do not earn their keep immediately.
6. Run test-coverage audit using `agent-docs/prompts/test-coverage-audit.md`.
7. Implement the highest-impact missing tests identified by the coverage pass when a real test harness exists, prioritizing proof at the highest stable behavior boundary available instead of only helper-level or snapshot coverage.
8. For user-visible, persisted-state, operational, or trust-boundary changes, capture at least one direct scenario check in addition to scripted tests and record the exact evidence. Examples: built CLI command, focused manual flow, browser inspection, or a narrow end-to-end path.
9. Re-run required checks after simplify + coverage updates.
10. Run final completion audit using `agent-docs/prompts/task-finish-review.md`.
11. Resolve high-severity findings before final handoff.
12. Final handoff must report required-check results plus any direct scenario evidence; green required checks remain the default completion bar.
13. If a required check fails for a credibly unrelated pre-existing reason, commit your exact touched files and hand off with the failing command, failing target, and why your diff did not cause it. If you cannot defend that separation, treat the failure as blocking.

## Coordination Ledger (Always Required)

- Before coding work, add an active row to `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Treat the row as an active-work notice by default, not a hard lock.
- Overlap is allowed when agents stay within their declared scope, read the current file state first, and preserve adjacent edits.
- Mark a row as exclusive in `Notes` only when overlap is unsafe, such as a broad refactor or a delicate cross-cutting rewrite.
- Update the row if file scope, symbol intent, or exclusivity expectations change.
- Remove the row immediately when the task is complete or abandoned.

## Audit Handoff Packet

When using a fresh subagent for coverage or completion audits, provide:

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
