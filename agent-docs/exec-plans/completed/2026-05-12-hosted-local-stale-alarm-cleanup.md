# Clear stale hosted-local UserRunner alarms before startup

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Stop stale hosted-local Durable Object alarms from a previous `pnpm dev` run from waking the runner before Wrangler has prepared the current local container image.

## Success criteria

- Startup cleanup removes local `UserRunnerDurableObject` state along with runner container DO state for the active worker namespace.
- Existing hosted-local container/image cleanup behavior stays scoped to the current worker namespace/build rules.
- Focused hosted-local cleanup tests cover the stale UserRunner state case.

## Scope

- In scope: hosted-local harness cleanup and focused tests.
- Out of scope: production Cloudflare runtime behavior, runner invocation retry semantics, broader hosted runner refactors.

## Constraints

- Technical constraints: preserve hosted workspace truth in web-owned state; do not depend on persisted local UserRunner DO coordination state across `pnpm dev` restarts.
- Product/process constraints: avoid secrets or local identifiers in logs/docs/tests.

## Risks and mitigations

1. Risk: clearing too much local state could hide a useful restart path.
   Mitigation: only clear local Durable Object coordination state; status/workspace truth is read from web-owned hosted workspace state after user binding.

## Tasks

1. Confirm stale alarm source. Done.
2. Patch hosted-local Durable Object cleanup. Done.
3. Update focused cleanup tests. Done.
4. Run focused verification. Done.

## Decisions

- Root cause: `cleanupHostedRunnerContainerLocalState` removes only `RunnerContainer` and `DeploySmokeRunnerContainer` DO storage, leaving stale `UserRunnerDurableObject` wake/backoff/write-fence rows and alarms to run on next startup.

## Verification

- Commands to run: focused hosted-local runtime cleanup tests; broader checks per verification routing if code changes require them.
- Expected outcomes: tests pass and prove UserRunner DO state is removed for the active namespace.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/runtime.cleanup.test.ts --no-coverage`: passed before and after final-review test coverage cleanup.
- `pnpm test:diff scripts/dev-hosted-local/runtime.ts scripts/dev-hosted-local/runtime.cleanup.test.ts`: blocked by unrelated repo TS tools failure in `scripts/murph-age/r399-midus2-biomarker-increment.ts` (`uniqueColumns` missing and argument mismatch).
- `pnpm test:repo-tools`: blocked by unrelated `scripts/murph-age/r399-midus2-biomarker-increment.test.ts` failures and unrelated hosted-local environment expectations around legacy internal proxy vars.
- `pnpm typecheck`: blocked by the same unrelated Murph Age script TypeScript errors.
Completed: 2026-05-12
