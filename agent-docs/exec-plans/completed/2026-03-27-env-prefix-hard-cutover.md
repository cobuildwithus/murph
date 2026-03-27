# Env Prefix Hard Cutover

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Remove the remaining branded `HB_` and `HEALTHYBOB_` runtime/env prefixes from the active config surface without widening into unrelated `HB_*` error/status codes.

## Success criteria

- Remove the historical `HB_HOSTED_BUNDLE_KEY` alias and require `HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY`.
- Replace the hosted per-user env prefix default from `HB_USER_` with a non-branded prefix.
- Remove `HEALTHYBOB_LINQ_*` aliases and use `LINQ_*` only across the live runtime/deploy surface.
- Replace `HEALTHYBOB_HOSTED_MEMBER_ID`, `HEALTHYBOB_ASSISTANT_FAULTS`, and `HEALTHYBOB_UNSAFE_FOREGROUND_LOG_DETAILS` with non-branded names.
- Rename the runner container's internal `HB_HOSTED_*` env names to non-branded names.
- Update directly affected docs/tests so the refactor is consistent and intentional.

## Constraints

- Keep the refactor scoped to live env/runtime/config names, not the larger `HB_*` validation/error-code family.
- Preserve adjacent in-flight Cloudflare, CLI, and hosted web edits already in the worktree.
- Backward compatibility is intentionally out of scope for this pass.

## Verification

- Focused Cloudflare verification passed:
  - `pnpm --dir ../.. exec vitest run apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/env.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run apps/cloudflare/test/user-env.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir ../.. exec vitest run apps/cloudflare/test/node-runner.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 -t 'restores the prior process env after per-user overrides are applied'`
  - `pnpm --dir apps/cloudflare typecheck`
- Focused hosted web verification passed:
  - `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-env.test.ts apps/web/test/linq-control-plane.test.ts --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir apps/web typecheck`
- Focused CLI verification passed:
  - `pnpm --dir ../.. exec vitest run packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-robustness.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/setup-channels.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir ../.. exec vitest run packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir ../.. exec vitest run packages/cli/test/setup-cli.test.ts --no-coverage --maxWorkers 1`
- Direct search verification:
  - `rg -n '\b(HB_HOSTED_BUNDLE_KEY|HB_USER_|HB_HOSTED_HOME|HB_HOSTED_MODELS_ROOT|HEALTHYBOB_LINQ_[A-Z0-9_]+|HEALTHYBOB_HOSTED_MEMBER_ID|HEALTHYBOB_ASSISTANT_FAULTS|HEALTHYBOB_UNSAFE_FOREGROUND_LOG_DETAILS)\b' . --glob '!**/node_modules/**' --glob '!**/.git/**'`
  - remaining matches are only the new negative-coverage test and execution-plan docs describing the cutover
- Required repo checks:
  - `pnpm typecheck` failed in unrelated `packages/contracts/scripts/verify.ts` typecheck/build state (`Cannot find module '@healthybob/contracts'` plus downstream implicit `any` errors).
  - `pnpm test` failed in unrelated `apps/web/src/lib/hosted-onboarding/{revnet,service}.ts` work (`viem` module resolution and `Invoice.payment_intent` typing).
  - `pnpm test:coverage` failed on the same unrelated `apps/web/src/lib/hosted-onboarding/{revnet,service}.ts` issues.
- Mandatory audit passes:
  - `simplify`: completed with no actionable simplify prompts.
  - `test-coverage-audit`: added `apps/cloudflare/test/user-env.test.ts` and an alias-removal boundary assertion in `apps/web/test/linq-control-plane.test.ts`.
  - `task-finish-review`: completed with no actionable findings.

## Outcome

- Active Cloudflare, hosted web, and CLI env readers now use the non-branded runtime names only.
- Legacy `HB_HOSTED_BUNDLE_KEY`, `HB_USER_*`, and `HEALTHYBOB_LINQ_*` aliases no longer work on the active runtime/config surface.
- The runner container and hosted execution path now use `HOSTED_HOME`, `HOSTED_MODELS_ROOT`, `HOSTED_MEMBER_ID`, `ASSISTANT_FAULTS`, and `UNSAFE_FOREGROUND_LOG_DETAILS`.
- The broader `HB_*` validation/error-code family was intentionally left unchanged.
