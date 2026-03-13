Goal (incl. success criteria):
- Simplify duplicated bank/history normalization and record-construction code without changing persisted shapes, ids, sort order, markdown layout, or defaults.
- Keep the edit surface inside unowned bank/history modules only.

Constraints/Assumptions:
- `packages/core/src/history/api.ts` is currently owned by another active lane, so mirrored history normalization there can be inspected but not edited in this pass.
- Do not touch forbidden core shared files or any files/symbols claimed by other ledger rows.
- Preserve frontmatter order, markdown section order/content, JSON/JSONL record shapes, and selection semantics.

Key decisions:
- Consolidate only duplication with immediate reuse inside `packages/core/src/bank/**` and `packages/core/src/history/**`.
- Prefer shared helper extraction over broader architecture changes.
- Report, but do not apply, any simplification that would require changing `history/api.ts` or a forbidden shared-core surface.

State:
- completed

Done:
- Read `AGENTS.md` and the documented read-order docs.
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Claimed unowned bank/history scope in the coordination ledger.
- Identified repeated body construction, selector logic, and upsert normalization across the bank modules.
- Added shared bank helpers for repeated markdown body blocks, bullet-list sections, selector-slug normalization, and raw-input-versus-persisted-value upsert resolution.
- Simplified goal, condition, allergy, and regimen modules to use the shared helpers without changing persisted output or lookup behavior.
- Verified `pnpm --dir packages/core typecheck` and `pnpm --dir packages/core test`.
- Ran repo-required checks; `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` are currently blocked by unrelated active-lane failures in `packages/contracts/**`, `packages/cli/**`, and `packages/inboxd/**`.

Now:
- Close the active plan, remove the coordination-ledger row, and commit the scoped files.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- `packages/core/src/history/api.ts` remains out of scope while another active lane owns it; its mirrored normalize/build/parse cleanup is still report-only for this pass.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-core-bank-history-simplify.md`
- `packages/core/src/bank/allergies.ts`
- `packages/core/src/bank/conditions.ts`
- `packages/core/src/bank/goals.ts`
- `packages/core/src/bank/regimens.ts`
- `packages/core/src/bank/shared.ts`
- `packages/core/src/history/shared.ts`
- `packages/core/src/history/types.ts`
- `packages/core/src/history/index.ts`
- Commands: `pnpm --dir packages/core typecheck`, `pnpm --dir packages/core test`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
