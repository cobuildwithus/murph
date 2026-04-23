# Align contracts schema artifacts and vault layout docs

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make the contracts package own one complete, generated JSON-schema surface for every canonical persisted contract family it already publishes, and realign the frozen vault-layout doc with the exported layout registry so code, docs, and generated artifacts agree.

## Success criteria

- `packages/contracts/src/schemas.ts` exports JSON schemas and stable metadata for memory, preferences, automations, and scheduled logs, and the generated `packages/contracts/generated/*.schema.json` set matches.
- Contracts examples/tests fail if a validated vault family is missing schema metadata or is absent from the schema-artifact seam.
- `docs/contracts/01-vault-layout.md` and `packages/contracts/src/vault-families.ts` describe the same vault roots, including automations, scheduled logs, recipes, and the documented query-owned library/knowledge directories.
- A contracts test fails if the frozen vault-layout doc drifts from the exported layout registry again.

## Scope

- In scope:
- `packages/contracts/src/{schemas.ts,vault-families.ts,memory.ts,preferences.ts,automation.ts,scheduled-log.ts,examples.ts}`
- `packages/contracts/generated/*.schema.json`
- `packages/contracts/{scripts/verify.ts,test/schema-catalog-examples.test.ts,test/vault-layout-validation.test.ts}`
- `docs/contracts/01-vault-layout.md`
- Out of scope:
- Query/core/runtime behavior changes beyond consuming the existing contracts package surface.
- Unrelated vault docs or broader knowledge-system redesign.

## Constraints

- Technical constraints:
- Preserve existing schema names and layout contracts unless a new stable name is required for the missing surfaces.
- Keep generated artifacts machine-derived from `schemaCatalog`; do not hand-edit drift into `generated/**`.
- Product/process constraints:
- Preserve unrelated dirty-tree edits and keep the commit scoped to this contracts/doc seam.
- Follow the repo completion workflow for a high-risk schema/storage change, including required verification and audit passes.

## Risks and mitigations

1. Risk: Adding layout entries could accidentally widen canonical query-source scanning.
   Mitigation: Model documented query-owned directories in the exported layout registry without reclassifying them as canonical query-source roots unless the existing query-source contract already requires that.
2. Risk: New schema metadata names could churn downstream consumers.
   Mitigation: Use stable, file-shaped `$id` values that match generated artifact names and keep catalog keys explicit and additive.
3. Risk: Dirty-tree overlap in shared docs/ledger files could cause accidental staging.
   Mitigation: Edit only the exact touched lines, verify the scoped diff before commit, and commit only explicit task paths.

## Tasks

1. Register the task in the coordination ledger and inspect the affected contracts, docs, and generated-artifact seam.
2. Add missing schema metadata/catalog exports and extend example plus artifact verification coverage so validated vault families cannot bypass the seam.
3. Extend the exported vault layout registry to cover the documented query-owned library/knowledge directories, update the frozen layout doc for the missing canonical paths, and add a doc-drift test.
4. Regenerate contracts schema artifacts, run the required scoped verification plus direct proof, then complete the mandatory coverage-write and final-review audit passes before the scoped commit.

## Decisions

- Prefer the exported contracts layout registry as the authoritative code owner, then make the frozen doc match it and add a drift test instead of letting the two evolve independently.
- Keep the query-owned library/knowledge directories in the layout registry but outside `VAULT_QUERY_SOURCE` so this fix aligns scaffold/layout truth without silently broadening canonical source scanning.

## Verification

- Commands to run:
- `pnpm --dir packages/contracts generate`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/contracts/src/schemas.ts packages/contracts/src/vault-families.ts packages/contracts/src/memory.ts packages/contracts/src/preferences.ts packages/contracts/src/automation.ts packages/contracts/src/scheduled-log.ts packages/contracts/src/examples.ts packages/contracts/generated packages/contracts/scripts/verify.ts packages/contracts/test/schema-catalog-examples.test.ts packages/contracts/test/vault-layout-validation.test.ts docs/contracts/01-vault-layout.md`
- `pnpm test:smoke`
- One direct proof command showing the new schema keys/layout exports after build.
- Expected outcomes:
- The contracts package builds, generated schema artifacts match source, scoped diff verification passes, smoke stays green, and the direct proof shows the new schema/layout entries.
Completed: 2026-04-23
