# CLI health simplify 2

Status: complete
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Remove the remaining repeated health CRUD group-registration shell from the allowed CLI command modules while preserving behavior.

## Success criteria

- The shared factory owns the repeated `Cli.create` plus CRUD registration flow.
- Simple noun command modules only supply noun-specific metadata and schemas.
- `profile` and `regimen` reuse the shared group-construction helper before attaching their extra subcommands.
- Verification and completion-workflow audit passes are run and documented.

## Scope

- In scope:
- `agent-docs/index.md`
- `packages/cli/src/commands/health-command-factory.ts`
- `packages/cli/src/commands/{allergy,condition,family,genetics,goal,history,profile,regimen}.ts`
- coordination metadata for this task
- Out of scope:
- forbidden CLI runtime/helper/test files
- visible CLI behavior, text, examples, hints, schemas, and command names/options

## Constraints

- Work on top of the current command-file state without reverting unrelated changes.
- Keep the abstraction local and immediate; no speculative generalization outside the health CRUD group pattern.
- Preserve the compatibility-only `--cursor` option and current CTA/example text.

## Risks and mitigations

1. Risk: centralizing group creation could alter command registration ordering.
   Mitigation: keep the helper a thin wrapper around the existing `Cli.create` then `registerHealthCrudCommands` sequence.
2. Risk: `profile` and `regimen` attach extra subcommands after CRUD registration.
   Mitigation: expose a helper that returns the created group so those files can continue attaching subcommands in the same order.

## Tasks

1. Add a shared health CRUD group helper in the factory.
2. Switch the simple noun files to the new helper.
3. Switch `profile` and `regimen` to the group-creation helper while preserving their extra commands.
4. Run scoped verification, required repo checks, audits, then commit.

## Outcome

- Done: added `createHealthCrudGroup` and `registerHealthCrudGroup` so the shared factory owns the repeated group creation and CRUD registration flow.
- Done: switched the simple noun command files to the shared group-registration helper.
- Done: switched `profile` and `regimen` to the shared group-construction helper before attaching their extra subcommands.
- Done: updated `agent-docs/index.md` because this task added a new active execution plan file.

## Verification

- `pnpm --dir packages/cli typecheck`
- Result: passed.
- `pnpm exec vitest run packages/cli/test/health-tail.test.ts --no-coverage --maxWorkers 1`
- Result: passed.
- `pnpm exec vitest run packages/cli/test/runtime.test.ts --no-coverage --maxWorkers 1`
- Result: passed.
- `pnpm exec vitest run packages/cli/test/list-cursor-compat.test.ts --no-coverage --maxWorkers 1`
- Result: failed on the existing expectation that `goal list` should no longer expose `--cursor`; this simplification preserved the current CLI surface.
- `pnpm test`
- Result: failed only on `packages/cli/test/list-cursor-compat.test.ts`; 14 test files passed and 1 failed.
- `pnpm typecheck`
- Result: failed in `packages/contracts/scripts/{generate-json-schema,verify}.ts` on unresolved `@healthybob/contracts/schemas`.
- `pnpm test:coverage`
- Result: failed before CLI coverage assertions due active query-model compile errors in `packages/query/src/model.ts`.

## Audit notes

- Simplify audit: no further immediate duplication remains in the allowed health command files beyond the completed group-registration extraction.
- Coverage audit: no safe in-scope test additions were applied because the strongest direct coverage already exists in `health-tail.test.ts` and `runtime.test.ts`; the remaining failing cursor test wants a behavior change that this task was not allowed to make.
- Finish review: no new behavior regressions reproduced after the targeted health/runtime reruns.
