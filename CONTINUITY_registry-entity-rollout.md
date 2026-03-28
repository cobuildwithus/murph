Goal (incl. success criteria):
- Port Condition, Allergy, Family, and Genetics onto the shared registry entity definition seam already proven by Goal, while keeping the same markdown plus JSONL storage model.

Constraints/Assumptions:
- Goal is already complete and acts as the reference pattern.
- This pass should follow the repo's greenfield posture for read schemas unless a strict exception is chosen deliberately.
- Partial-update behavior for explicit CLI upserts should stay patch-like where that is already the established write surface.
- Overlapping active rows exist in shared CLI and query files; preserve adjacent edits.

Key decisions:
- The final landed diff includes all four requested registry families in one rollout: Condition, Allergy, Family, and Genetics.
- Keep the greenfield hard-cut posture for shared frontmatter reads.
- Preserve patch-style explicit CLI upserts by validating through shared patch payload schemas where available.
- Family keeps no noun-specific status filter; genetics continues to expose significance through the shared status filter path.

State:
- Ready to close.

Done:
- Re-opened the coordination ledger and active execution plan for the registry rollout.
- Opened an execution plan for the registry rollout.
- Landed shared registry metadata in contracts for Condition, Allergy, Family, and Genetics.
- Switched core Condition/Allergy/Family/Genetics read-write seams onto the shared definitions, including normalized internal links for all four families.
- Wired query and CLI consumers to the shared registry metadata for all four families.
- Added focused regressions across core, query, and CLI for the migrated families.
- Ran focused verification successfully:
  - `pnpm --dir packages/contracts build`
  - `node packages/contracts/dist/scripts/verify.js`
  - `pnpm --dir packages/core build`
  - `pnpm --dir packages/query build`
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/query typecheck`
  - `pnpm exec vitest run packages/core/test/health-bank.test.ts packages/core/test/health-history-family.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/query/test/health-registry-definitions.test.ts packages/cli/test/health-tail.test.ts --no-coverage --maxWorkers 1`

Now:
- Closing the active plan and committing the scoped rollout files.

Next:
- Close the active plan, clean the ledger row, and commit the rollout with the exact touched files.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether genetics should keep treating `significance` as the noun-specific status filter long-term, or whether that should move to a genetics-specific filter vocabulary in a later pass.
- Mandatory completion-workflow audit subagents were attempted, but the environment hit the subagent thread limit and then the wrapper behaved inconsistently after the worker pool was cleared. Rerun those dedicated passes from a clean pool if strict proof is required.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-29-registry-entity-rollout.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_registry-entity-rollout.md`
- `packages/contracts/src/{health-entities.ts,shares.ts}`
- `packages/core/src/{bank/{allergies.ts,conditions.ts,types.ts},family/{api.ts,types.ts},genetics/{api.ts,types.ts}}`
- `packages/query/src/health/registries.ts`
- `packages/cli/src/{health-cli-descriptors.ts,usecases/explicit-health-family-services.ts}`
- `packages/core/test/{health-bank.test.ts,health-history-family.test.ts}`
- `packages/query/test/health-registry-definitions.test.ts`
- `packages/cli/test/health-tail.test.ts`
