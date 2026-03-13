Goal (incl. success criteria):
- Remove remaining hand-rolled validation in free core storage files where existing contract schemas already cover the shape.
- Keep storage behavior and error surfaces stable enough for existing runtime tests.

Constraints/Assumptions:
- Do not edit files owned by the active contracts, storage-spine, importer, query, or release lanes.
- Keep scope to `packages/core/src/assessment/storage.ts`, `packages/core/src/profile/storage.ts`, this plan doc, and the coordination ledger.
- Rely on existing tests because `packages/core/test/**` is currently owned elsewhere.

Key decisions:
- Prefer existing `@healthybob/contracts` schemas over introducing new local validation helpers.
- Focus on behavior-preserving substitutions: plain-object parsing, contract-backed record parsing, and validated current-profile attributes.

State:
- in_progress

Done:
- Reviewed repo instructions, completion workflow, and active ownership constraints.
- Explored importer/query alternatives and ruled them out due to active ownership rows.
- Identified free core storage files with contract-covered validation still done by hand.

Now:
- Replace assessment-storage plain-object/relatedIds handroll with contract-backed parsing.
- Replace profile-storage plain-object/frontmatter-attribute handroll with contract-backed parsing where feasible.

Next:
- Run simplify, coverage audit, required verification, and commit the scoped files.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether any callers depend on exact nested error payloads from the current manual assessment/profile validation branches.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/core/src/assessment/storage.ts`
- `packages/core/src/profile/storage.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
