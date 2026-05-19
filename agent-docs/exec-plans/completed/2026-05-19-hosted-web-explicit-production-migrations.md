# Decouple hosted web production migrations from package build

Status: completed
Created: 2026-05-19
Updated: 2026-05-19

## Goal

- Decouple hosted web production database migrations from the generic package
  build command while preserving automatic Vercel deploy migrations through an
  explicit, guarded release command.

## Success criteria

- `pnpm --dir apps/web build` remains artifact generation and validation only.
- Vercel deploys automatically run the guarded release migration command before
  the non-mutating build command.
- Production migrations still use the existing guarded wrapper and direct
  database URL checks.
- Tests fail if `build` starts invoking the production migration command again.
- Hosted web release docs describe the explicit migration step and
  backward-compatibility requirement.

## Scope

- In scope: hosted web package scripts, Vercel deploy config, production
  migration guard tests, and durable docs that describe hosted web release/build
  behavior.
- Out of scope: changing Prisma migrations, Vercel project settings, or live
  production deployment.

## Constraints

- Technical constraints: keep production migrations gated to main-branch Vercel
  production deploy environments and keep `DIRECT_DATABASE_URL` validation.
- Product/process constraints: no secrets, environment values, or local user
  identifiers in docs, logs, or generated files.

## Risks and mitigations

1. Risk: Vercel deploys stop running production migrations automatically.
   Mitigation: Configure the checked-in Vercel build command to run the explicit
   guarded migration command before the non-mutating build.
2. Risk: A later package script change silently re-couples migrations to build.
   Mitigation: Update the guard test to assert `build` does not invoke
   production migrations.

## Tasks

1. Rename the production migration package script away from prebuild semantics.
2. Remove production migration execution from the generic hosted web build.
3. Update the production migration guard test to assert automatic Vercel
   migration execution and non-mutating package build behavior.
4. Update hosted web and testing/CI docs for the new release contract.
5. Run focused and required verification, then complete required audits and
   commit scoped changes.

## Decisions

- Keep the existing guarded TypeScript migration wrapper instead of introducing
  new migration logic.
- Use an explicit `release:production:migrate` package script as the migration
  entrypoint; run it from `apps/web/vercel.json`'s deploy build command, not
  from the reusable package `build` script.

## Verification

- Commands to run: focused production migration guard test, `pnpm typecheck`,
  and the routed hosted-web verification lane (`pnpm verify:acceptance` unless a
  truthful diff-aware lane fully covers the change).
- Expected outcomes: all required checks pass, or unrelated blockers are named
  with focused proof for this diff.
- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/production-migration-guard.test.ts --no-coverage --maxWorkers 1`
  - `jq empty apps/web/package.json apps/web/vercel.json`
  - `git diff --check -- apps/web/package.json apps/web/vercel.json apps/web/test/production-migration-guard.test.ts apps/web/README.md agent-docs/references/testing-ci-map.md agent-docs/exec-plans/active/2026-05-19-hosted-web-explicit-production-migrations.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm typecheck`
  - `pnpm test:diff apps/web/package.json apps/web/vercel.json apps/web/test/production-migration-guard.test.ts apps/web/README.md agent-docs/references/testing-ci-map.md`
  - `CODEX_HOME="$HOME/.codex-3" clawpatch --root . revalidate --finding fnd_sig-feat-release-51170e0f9c-ccc4_cd15215dee` from `apps/web` reported `outcome: fixed`

## Review

- Security/privacy review: no findings.
- Coverage-write review: coverage adequate, no edits.
- Task-finish review: no findings.
Completed: 2026-05-19
