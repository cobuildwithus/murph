# iMessage residue audit cleanup

Status: completed
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Remove remaining repo residue that still documents, tests, or structurally assumes live iMessage support after the decommission, while preserving Linq support and legacy fail-closed migration behavior where still required.

## Success criteria

- Remaining non-plan docs and architecture text no longer claim or imply live iMessage support.
- Stale test fixtures or assertions that still assume supported iMessage behavior are removed or updated.
- Any residual architectural or code-adjacent references that only existed to support live iMessage delivery are either removed or explicitly framed as legacy sanitization/fail-closed compatibility.
- Required verification and repo-policy audit passes complete, or any unrelated pre-existing failures are documented.

## Scope

- In scope:
  - Non-plan Markdown docs under repo docs surfaces.
  - Architecture text and durable agent docs that still mention live iMessage support.
  - Tests and nearby code-adjacent residue that still assumes live iMessage behavior.
  - Narrow cleanup diffs needed to keep the decommission story consistent.
- Out of scope:
  - Reworking the main runtime decommission already in flight in overlapping lanes.
  - Broad product or channel redesign beyond removing stale iMessage residue.
  - Historical plan docs under `agent-docs/exec-plans/completed/`.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty worktree edits and overlapping scheduler/route-estimation changes.
  - Keep Linq support and any intentional legacy iMessage sanitization/fail-closed behavior intact.
  - Do not touch plan archives or speculative surfaces.
- Product/process constraints:
  - Use subagents for the thorough audit requested by the user.
  - Follow the standard repo-change workflow with plan, ledger, verification, required audits, and scoped commit.

## Risks and mitigations

1. Risk: Overwriting nearby edits from concurrent iMessage decommission or scheduler work.
   Mitigation: Limit edits to direct stale-reference files, inspect diffs carefully, and avoid reverting adjacent changes.
2. Risk: Removing references that still document legacy sanitization behavior needed for safe migration.
   Mitigation: Distinguish live-support claims from intentional legacy compatibility paths before editing.

## Tasks

1. Audit the repo for remaining iMessage references outside plan docs, split across docs, tests, and architecture/code-adjacent residue.
2. Apply the smallest set of cleanup edits that remove stale live-support references while preserving Linq and legacy fail-closed behavior.
3. Re-run targeted searches and verification to confirm the residue is gone or intentionally documented.
4. Run required audit passes, then finish the task with a scoped commit.

## Decisions

- Historical plan docs remain untouched even if they mention iMessage.
- Legacy compatibility references may remain only when they describe pruning, sanitization, or fail-closed handling rather than live support.
- Historical generated and release-note docs remain untouched because they record past state rather than current support.
- Linq `service: "iMessage"` payload fixtures remain in place where they verify upstream metadata preservation or privacy minimization rather than a live Murph iMessage channel.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>` if truthful for the final touched set, otherwise the touched owner coverage command(s)
  - Required completion-workflow audit passes: `coverage-write` if the verification lane is coverage-bearing, plus `task-finish-review`
- Expected outcomes:
  - Verification covers the touched owners without regressing overlapping work.
  - Final targeted searches show no unintended non-plan live iMessage references in the cleaned surfaces.
- Outcomes:
  - `pnpm typecheck`: passed.
  - `pnpm --dir packages/inboxd test:coverage`: passed.
  - `pnpm test:smoke`: passed.
  - `pnpm test:diff packages/inboxd/test/idempotency-rebuild.test.ts packages/inboxd/test/inboxd.test.ts`: first exposed a real redaction-fixture mismatch that was fixed; a later rerun reached green inboxd coverage but was terminated in a broader unrelated reverse-dependent lane during `packages/setup-cli` tests, so the touched-owner fallback lane above is the final verification basis.
  - Required `coverage-write` pass: no additional test edits needed.
  - Required `task-finish-review` pass: no findings.
Completed: 2026-04-10
