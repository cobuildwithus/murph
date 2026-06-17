# Medication History Facade

## Goal

Make historical medication courses from records easy to save without creating a second medication storage model.

Success criteria:

- Historical medication courses are saved as existing `regimen` records with `kind: medication`.
- A medication-specific CLI facade defaults historical courses to completed medication regimens.
- Assistant guidance sends old medication courses to the medication/regimen history surface, not dose-by-dose intake events.
- Regimen records can carry a small note for provenance or uncertainty when evidence comes from records.

## Constraints

- Do not create a new canonical medication family or ledger.
- Keep canonical writes routed through existing core regimen mutation paths.
- Keep command additions thin and regimen-backed.
- Do not persist signed URLs or unrelated source identifiers.
- Preserve current `event medication-intake add` semantics for actual intake events.

## Working Set

- `packages/contracts/src/shares.ts`
- `packages/contracts/src/zod.ts`
- `packages/contracts/generated/frontmatter-regimen.schema.json`
- `packages/core/src/bank/types.ts`
- `packages/core/src/bank/regimens.ts`
- `packages/vault-usecases/src/usecases/explicit-health-family-services.ts`
- `packages/vault-usecases/src/usecases/types.ts`
- `packages/cli/src/commands/*`
- `packages/cli/test/*`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `docs/contracts/02-record-schemas.md`
- `docs/contracts/03-command-surface.md`

## Verification Plan

- Focused CLI/schema tests for medication facade and regimen note persistence.
- Prompt behavior test for historical medication routing.
- `pnpm test:diff` over touched files when implementation is stable.
- Required completion audits for persisted/user-facing health-data exposure and coverage.

## Status

- Implemented `note` on regimen frontmatter/upsert/projection/core/usecase paths.
- Implemented `medication save` and `medication history add` as regimen-backed CLI facades.
- Updated assistant prompt guidance, command docs, generated contract schema, and generated CLI schema.
- Passed focused CLI, contracts, and assistant prompt tests.
- Passed `pnpm typecheck`, scoped `pnpm test:diff ...`, and `pnpm test:smoke`.
- Security/privacy audit completed with no accepted findings.
- Coverage-write audit added focused proof for regimen note round-trip and no medication-intake event ledger writes.
- Deep-review audit found two accepted findings; fixed with date-qualified medication-history slugs and stricter assistant guidance for historical medication courses.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
