Goal (incl. success criteria):
- Hard-cut `vault-cli supplement save` away from one primary ingredient and allow saving complete structured ingredient panels with repeatable ingredient input.
- Preserve supplement/regimen storage invariants and keep the command simple for agents and humans.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits.
- Keep the architecture simple: no new bulk import command unless existing save cannot express the payload cleanly.
- Ingredient payloads should use the existing regimen ingredient contract rather than a parallel supplement-only shape.

Key decisions:
- Use repeated `--ingredient` JSON object flags for supplement save.
- Remove old scalar primary ingredient flags from supplement save.
- Enforce the canonical ingredient-count limit across contracts and core normalization.

State:
- Implementation and verification complete; ready to archive during finish-task.

Done:
- Replaced supplement save scalar primary ingredient flags with repeated structured `--ingredient` JSON-object flags.
- Enforced `SUPPLEMENT_INGREDIENTS_MAX_ITEMS` across contracts, generated frontmatter schema, core normalization, and CLI option schema.
- Updated assistant guidance, command-surface docs, generated CLI schema/types, and focused regression tests.
- Ran focused package tests, full typecheck, diff verification, and final task-finish review.

Now:
- Prepare scoped commit and close the active plan.

Next:
- None after commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/cli/src/commands/supplement.ts`
- `packages/vault-usecases/src/usecases/explicit-health-family-services.ts`
- `packages/vault-usecases/src/usecases/types.ts`
- `packages/contracts/src/constants.ts`
- `packages/contracts/src/shares.ts`
- `packages/contracts/src/zod.ts`
- `packages/contracts/generated/frontmatter-regimen.schema.json`
- `packages/core/src/bank/regimens.ts`
- `packages/core/test/health-bank.test.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `packages/cli/config.schema.json`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/test/*supplement*`
- `packages/cli/test/health-tail.test.ts`
- `packages/cli/test/cli-typed-agent-inputs-schema.test.ts`
- `docs/contracts/03-command-surface.md`
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
