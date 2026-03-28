Murph cleanup lane: simplify duplicated record-to-payload projection between share-pack export and bank registry code in `packages/core`.

Ownership:
- Own `packages/core/src/{shares.ts,bank/protocols.ts,bank/recipes.ts,bank/foods.ts}`.
- Own direct coverage in `packages/core/test/{share-pack.test.ts,health-bank.test.ts}`.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Relevant code:
- `packages/core/src/shares.ts`: `addProtocolRecord`, `addFoodRecord`, `addRecipeRecord`
- `packages/core/src/bank/protocols.ts`: `buildAttributes`
- `packages/core/src/bank/recipes.ts`: `buildAttributes`
- `packages/core/src/bank/foods.ts`: `buildAttributes`
- edge contracts: `protocolUpsertPayloadSchema`, `recipeUpsertPayloadSchema`, `sharePackFoodPayloadSchema`

Issue:
- Share-pack export re-lists canonical record fields for protocol, recipe, and food payloads even though nearby bank code already projects many of the same fields from the same records.
- The field lists are schema-adjacent and easy to drift as new fields are added.

Best concrete fix:
- Create tiny per-entity mappers for `record -> canonical payload-ish shape` in the bank modules or a nearby mapper file, then reuse them from `shares.ts`.
- A likely pattern:
  - `protocolRecordToUpsertPayload(record)`
  - `recipeRecordToUpsertPayload(record)`
  - `foodRecordToBasePayload(record)`
- Let `buildAttributes` compose schema, doc type, and id around the reusable payload mapping where that makes sense.
- Let `shares.ts` reuse the same mapping and layer only share-pack-specific transforms on top.
- For food, keep `attachedProtocolIds` vs `attachedProtocolRefs` as a thin wrapper, not a forced abstraction.

Do not change:
- share-pack output shape
- ref generation
- attached protocol expansion behavior
- import semantics on the receiving side

Tests to anchor:
- `packages/core/test/share-pack.test.ts`
- `packages/core/test/health-bank.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
