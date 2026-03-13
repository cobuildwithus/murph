# CLI health simplify

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Simplify the allowed health CRUD CLI command modules and their shared command-factory helpers without changing externally visible behavior.

## Success criteria

- Repeated noun-specific service interface/cast boilerplate is reduced inside the allowed files.
- Repeated list/scaffold/show/upsert service wiring is collapsed only where reuse is immediate and behavior stays unchanged.
- `health-command-factory.ts` keeps the same examples, hints, and CTA text while shedding no-op helper fan-out.
- Verification and completion-workflow audit passes are run, and only touched files are committed.

## Scope

- In scope:
- `packages/cli/src/commands/health-command-factory.ts`
- `packages/cli/src/commands/{allergy,condition,family,genetics,goal,history,profile,regimen}.ts`
- coordination/plan metadata for this task
- Out of scope:
- forbidden CLI runtime/helper files from the user prompt
- visible CLI behavior, command names/options, output schemas, examples, hints, and CTA text
- test additions outside the narrowest credible verification path

## Constraints

- Respect active ownership rows and do not touch files owned by other agents.
- Work on top of pre-existing edits in the allowed files; do not revert or rewrite them wholesale.
- Avoid new abstractions unless they remove repetition across the allowed files immediately.
- Run completion-workflow audit passes because this changes production CLI code.

## Risks and mitigations

1. Risk: shared helper extraction could accidentally change type inference or command metadata wiring.
   Mitigation: keep helpers local to the existing files, preserve current call order, and verify with package-local typecheck/tests plus repo checks.
2. Risk: several allowed files already have uncommitted edits.
   Mitigation: inspect existing diffs before patching and limit edits to the simplification symbols claimed in the ledger.
3. Risk: some deeper simplifications would want changes in forbidden files such as `command-helpers.ts` or runtime wiring.
   Mitigation: leave those opportunities unimplemented and report them in handoff instead of crossing scope.

## Tasks

1. Inspect the allowed command files for repeated service interfaces, casts, and CRUD wiring.
2. Apply behavior-preserving simplifications only where reuse is immediate inside the allowed files.
3. Run scoped verification, then required repo checks and completion-workflow audits.
4. Remove the ledger row and commit only the touched files with `scripts/committer`.

## Decisions

- Keep simplifications local to the allowed command modules and shared factory file.
- Prefer small helper extraction over wider shared-module refactors because the forbidden-file boundary blocks cleaner centralization.
- Treat all visible CLI text and shape as locked.

## Outcome

- Done: simplified the shared health CRUD command factory by replacing the repeated method-result generics with method-name inference tied to the selected service methods.
- Done: collapsed repeated CTA scaffolding behind `suggestedCommandsCta`, preserving command text while removing duplicate wrapper objects.
- Done: collapsed example and hint helper fan-out into keyed resolvers without changing emitted examples or hint text.
- Not applied: broader command-module rewrites that would only restate the same behavior already present in the current tree by the end of this pass.

## Verification

- `pnpm --dir packages/cli typecheck`
- Result: failed for pre-existing package-local issues outside the health command surface (`packages/cli/src/commands/inbox.ts`, `packages/cli/src/inbox-services.ts`).
- `pnpm exec vitest run packages/cli/test/health-tail.test.ts packages/cli/test/list-cursor-compat.test.ts --no-coverage --maxWorkers 1`
- Result: `health-tail.test.ts` passed; `list-cursor-compat.test.ts` failed because the current CLI still exposes the compatibility-only `--cursor` option that this simplification preserved.
- `pnpm typecheck`
- Result: failed in `packages/contracts/scripts/{generate-json-schema,verify}.ts` on unresolved `@healthybob/contracts/schemas`.
- `pnpm test`
- Result: failed only on `packages/cli/test/list-cursor-compat.test.ts` for the same existing `--cursor` expectation mismatch.
- `pnpm test:coverage`
- Result: failed only on `packages/cli/test/list-cursor-compat.test.ts` for the same existing `--cursor` expectation mismatch.
- completion workflow audit passes using:
- `agent-docs/prompts/simplify.md`
- `agent-docs/prompts/test-coverage-audit.md`
- `agent-docs/prompts/task-finish-review.md`
- Audit outcome: no additional safe simplifications or in-scope test additions identified beyond the completed factory cleanup; residual risk remains the pre-existing cursor-contract/test mismatch.
Completed: 2026-03-13
