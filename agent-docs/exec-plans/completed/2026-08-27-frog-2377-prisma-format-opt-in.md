# Guard hosted Prisma formatting

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Prevent ordinary focused hosted-Web Prisma work from accidentally rewriting
  the full checked-in schema while retaining an explicit path for intentional
  repository-wide schema normalization.

## Success criteria

- The default hosted-Web `prisma format` command fails before mutating a schema
  and points contributors to the non-mutating validation command.
- An explicit, documented opt-in still permits intentional full-schema format
  work.
- Prisma validation, generation, and other CLI commands are unaffected.
- Focused tests and direct CLI proof cover the policy boundary.

## Scope

- In scope: the hosted-Web Prisma CLI config, its focused policy test, and the
  existing Prisma workflow documentation.
- Out of scope: formatting or otherwise changing the checked-in Prisma schema,
  migrations, product runtime behavior, dependencies, and CI configuration.

## Constraints

- Technical constraints: Prisma 7.8 formats only whole schema files; it exposes
  no model- or range-scoped formatter. The opt-in must be checked before local
  env files load so a persistent local file cannot silently authorize it.
- Product/process constraints: keep the repair repository-local, narrow, and
  reversible; do not change deployed behavior or database shape.

## Risks and mitigations

1. Risk: a broad argv match could block unrelated Prisma commands.
   Mitigation: match the exact `format` subcommand and cover non-format and help
   invocations in focused tests.
2. Risk: the guard could make intentional normalization impossible.
   Mitigation: preserve a named process-level opt-in and document the exact
   command beside the existing schema workflow.

## Tasks

1. Add a focused failing regression test for the real Prisma CLI boundary.
2. Add the opt-in policy directly to `apps/web/prisma.config.ts` before
   env-file loading.
3. Document focused validation and the explicit full-format opt-in.
4. Run focused tests, Prisma validation, direct mutation/no-mutation proof,
   typecheck, and diff/privacy inspection.
5. Commit, push, open the draft Frog PR, and drive the required exact-head
   review and CI gates.

## Decisions

- Rejected another prose-only warning because the current README warning
  predates the friction report and did not prevent the recurrence.
- Rejected whole-schema normalization because the reproduced mechanical diff
  changes 1,868 lines and is unrelated to the ordinary additive schema task.
- Use a process-level opt-in rather than a new dependency or formatter.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/prisma-format-policy.test.ts`
  passed with both real-CLI regression cases.
- `pnpm --dir apps/web exec eslint prisma.config.ts test/prisma-format-policy.test.ts`
  passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web prisma:validate` passed.
- Direct isolated CLI proof shows default `prisma format` fails without changing
  the target and explicit opt-in formats the target successfully; passed.
- `git diff --check` and the added-line public-safety scan passed.
Completed: 2026-08-27
