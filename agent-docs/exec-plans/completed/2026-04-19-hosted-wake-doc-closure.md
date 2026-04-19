# Hosted Wake Docs Closure

## Goal

Close the remaining hosted-wake documentation ambiguity by stating the implemented hosted behavior model directly in the live hard-cut guide.

Success criteria:
- the live hosted hard-cut guide says hosted wake behaviors are `ordered` and `coalescing` only
- the live guide says parser follow-up remains inline on `conversation.message`
- no immutable completed-plan snapshots are edited

## Constraints / Assumptions

- Treat `agent-docs/exec-plans/completed/**` as immutable historical records.
- Keep the change limited to live docs/process files.
- Preserve unrelated in-flight worktree edits.

## Key Decisions

- Resolve the ambiguity in the live migration guide instead of adding a new hosted `edge_triggered` / `parser.drain` contract.
- Leave historical completed plans unchanged even when they mention the old open question.

## State

- In progress; scoping and doc-target discovery are complete.

## Done

- Loaded repo routing and verification docs for a docs-only repo change.
- Confirmed the live hosted implementation already exposes only `ordered` and `coalescing`.
- Confirmed hosted parser work stays inline on `conversation.message` ingestion.
- Confirmed the remaining `edge_triggered` / `parser.drain` references are historical completed-plan snapshots, not current runtime contracts.

## Now

- Patch the live hosted hard-cut migration guide to make the final wake-behavior decision explicit.

## Next

- Read back the touched docs and check for obvious reference drift.
- Commit only the docs-plan artifacts for this lane.

## Open Questions

- None.

## Working Set

- `docs/hosted-hard-cut-migration-guide.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-19-hosted-wake-doc-closure.md`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
