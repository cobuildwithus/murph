# Remove review:gpt-backed research CLI

## Goal

Remove the unused `review:gpt` dependency and the `vault-cli research` / `vault-cli deepthink` command surface so a user-supplied vault path cannot steer Murph into executing `review:gpt` package scripts from untrusted ancestry.

Success criteria:

- `vault-cli research` and `vault-cli deepthink` are no longer registered, generated, tested, or documented as live commands.
- The root workspace no longer depends on `@cobuild/review-gpt` or exposes root package scripts that invoke it.
- Focused CLI tests, typecheck, and package verification cover the removed command surface.

## Scope

- In: CLI command registration/runtime/contracts/tests, root package scripts/dependency metadata, README/command contract references, scenario coverage metadata.
- Out: immutable completed execution-plan snapshots and unrelated Health Commons content.

## Risks

1. Stale generated incur/config artifacts could keep removed commands visible.
   Mitigation: regenerate CLI generated artifacts after command removal.
2. Root script tests may still require review-gpt helper scripts.
   Mitigation: update tests to assert the surface is absent instead of routed through the package.
3. Existing unrelated dirty work may block a safe scoped commit.
   Mitigation: keep this diff isolated and report any commit blocker explicitly.

## Plan

1. Remove the CLI runtime, command registration, manifest group, generated types/config, smoke scenarios, and focused tests for `research` / `deepthink`.
2. Remove the root `@cobuild/review-gpt` dependency, root review/thread package scripts, and matching supply-chain exceptions.
3. Update live README/contracts/tests to reflect that the review-gpt-backed commands are not available.
4. Run focused CLI verification, typecheck, and direct command-surface checks.
5. Run required security/privacy and completion review passes, then close the plan through the scoped commit path if the dirty tree allows it.

## Verification

- `pnpm install --lockfile-only` passed.
- `pnpm --dir packages/cli gen:config-schema` passed.
- `pnpm deps:guard` passed.
- `pnpm deps:ignored-builds` passed with existing `workerd` ignored-build output.
- `pnpm deps:audit` exited 0 and reported one moderate vulnerability, no high-severity advisory.
- Direct command proof passed: `vault-cli research ...` and `vault-cli deepthink ...` return `COMMAND_NOT_FOUND`; `vault-cli --llms --format json` search found no `research`, `deepthink`, or review-gpt entries.
- `pnpm typecheck` passed.
- `pnpm --dir packages/cli verify:package-shape` passed.
- Focused no-coverage tests passed: CLI focused tests (117 tests), assistant watchdog support (23 tests), Cloudflare runner-bundle dependency install (6 tests).
- `bash scripts/workspace-verify.sh test:diff ...` passed CLI targeted verification (341 tests) but failed later in unrelated dirty `scripts/hosted-local.test.ts` expecting no bespoke local E2E scripts while unrelated active hosted-local work has `test:e2e:runner-control-token:local`.
- `pnpm --dir packages/assistant-engine test:coverage -- packages/assistant-engine/test/assistant-automation-support.test.ts` passed.
- `pnpm --dir apps/cloudflare test -- apps/cloudflare/test/runner-bundle-dependency-install.test.ts` passed.
- Full `pnpm --dir packages/cli test:source:coverage` passed after rerunning prepared runtime without concurrent package-build interference.
- `git diff --check -- <scoped task files>` passed.
- Coverage audit added explicit negative assertions that `research` / `deepthink` stay absent from the CLI descriptor and LLM manifest; `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-cli.test.ts test/incur-smoke.test.ts` passed.
- Security/privacy audit found two stale references after the main removal: assistant cron presets still mentioned a separate research tool, and a stale active HBot plan still described upgrading the review-gpt-backed workflow. Both were removed or rewritten.
- Post-security-fix focused checks passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/incur-smoke.test.ts` and `pnpm --dir packages/assistant-engine typecheck`.
- Final scoped `git diff --check -- <task files>` passed.
- Final direct command proof passed again: `vault-cli research ...` and `vault-cli deepthink ...` return `COMMAND_NOT_FOUND`; `vault-cli --llms --format json` search found no `research`, `deepthink`, or review-gpt entries.
- Finish review found no live command/package-script surface; one stale test temp path was renamed from a review-gpt label to a neutral data-context label.
- Final expanded focused CLI run passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/incur-smoke.test.ts`.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
