# Dedupe hosted cutover active plans against current repo state

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Remove stale hosted-cutover plan state from `active/` so the remaining open work matches the current code and doc surface.

## Success criteria

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` no longer points at archived hosted-cutover plans that already live under `completed/`.
- The active-plan set keeps only genuinely open hosted-cutover follow-ups.
- This plan captures which of the supplied “remaining fixes” are landed, still open, or only partially open.

## Scope

- In scope:
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-19-hosted-cutover-plan-dedupe.md`
- moving already-landed hosted-cutover plans from `active/` to `completed/`
- Out of scope:
- Runtime or schema changes in `apps/web`, `apps/cloudflare`, or `packages/**`
- Rewriting other agents' in-progress plan files unless the repo state makes that unavoidable

## Constraints

- Technical constraints:
- Preserve unrelated in-flight worktree edits and half-completed plan moves already present in the tree.
- Product/process constraints:
- Keep this as a docs/process-only dedupe pass.
- Use static code/doc evidence plus subagent inspection; do not invent missing runtime proof.

## Risks and mitigations

1. Risk: removing the wrong ledger rows could hide still-active work.
   Mitigation: only remove rows whose plan files are already archived under `completed/` and whose notes mark them completed.
2. Risk: editing another lane's active plan file could conflict with in-flight work.
   Mitigation: keep plan-text rewrites limited to the active hosted-wake plan summaries and avoid touching runtime files.

## Tasks

1. Inspect the active hosted-cutover plans, ledger rows, and the current code/docs for the eight supplied remaining items.
2. Use `gpt-5.4` high explorer subagents to verify which items are open, landed, or partial.
3. Remove stale completed hosted-cutover ledger rows that still reference archived active-plan paths.
4. Record the deduped status mapping here and verify the touched docs/process files.

## Decisions

- Treat the dedupe work as a coordination cleanup, not a runtime-fix lane.
- Tighten the active hosted-wake summaries only when they still claim already-landed work is open.
- Consider a supplied item “landed” when the stale behavior is already removed from live code/docs, even if old wording survives in archived plans.

## Findings

- Item 1 (`commitHostedExecutionCursorTx` snapshot-only cursor CAS): landed in the current worktree. Same-seq snapshot-only cursor updates are already implemented and covered by test, so this should no longer appear as an open blocker in active plan text.
- Item 2 (user-scoped wake lifecycle dereference): partially landed. Owner-scoped schema and high-value callers are fixed, but lower-level helpers still permit unscoped event-id dereference and do not fail closed at the helper boundary.
- Item 3 (quarantine bypasses fetched-wake proof): still open. Quarantine still accepts only `wakeId` and `quarantineCode`, without the fetched-wake proof/fence that terminal receipts require.
- Item 4 (`user-key-store` activation-only writer claim): landed in code. `require-existing` now fails closed instead of repairing or reconciling durable envelope state at runtime, so this should not remain part of the still-open cutover blocker set.
- Item 5 (docs/process cutover truth): still open. Completed Cloudflare migration plans were still listed in the active ledger, and the repo spec still claims a single hosted Prisma baseline while the active migration chain is incremental.
- The root README queue-owner wording is already corrected in the worktree and should be treated as landed, not as remaining work.

## Verification

- Commands to run:
- `git diff -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-19-hosted-cutover-plan-dedupe.md`
- direct readback of the touched files
- Expected outcomes:
- The ledger no longer contains the stale completed hosted-cutover rows.
- This plan records the landed/open mapping for the supplied remaining-fixes list.
Completed: 2026-04-19
