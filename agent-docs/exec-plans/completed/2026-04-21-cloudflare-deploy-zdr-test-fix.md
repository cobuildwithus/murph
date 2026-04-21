Goal (incl. success criteria):
- Fix the Cloudflare deploy workflow failure by preventing deploy-only hosted assistant env from breaking the `apps/cloudflare` Node test lane, while preserving real deploy/runtime behavior.

Constraints/Assumptions:
- Preserve unrelated dirty-tree edits and active coordination rows.
- Keep the fix scoped to `apps/cloudflare` test/runtime-envelope behavior unless reproduction proves a production runtime defect.
- Do not expose secrets or local personal identifiers in outputs or files.

Key decisions:
- Reproduce the failure under deploy-like hosted assistant env before patching.
- Prefer test isolation over weakening hosted assistant runtime validation.

State:
- completed

Done:
- Read repo workflow, verification, security, reliability, and coordination docs.
- Confirmed the failing workflow is `Deploy Cloudflare Hosted Execution` run `24714957432`.
- Traced the failure to `apps/cloudflare/test/node-runner.test.ts` inheriting deploy-time `HOSTED_ASSISTANT_*` env through the ambient forwarded-env fallback.
- Reproduced the failure mode locally with ambient `HOSTED_ASSISTANT_ZERO_DATA_RETENTION=true`.
- Isolated `apps/cloudflare/test/node-runner.test.ts` by capturing, clearing, and restoring `HOSTED_ASSISTANT_CONFIG_ENV_NAMES` around each test.
- Verified with `HOSTED_ASSISTANT_ZERO_DATA_RETENTION=true pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/node-runner.test.ts`.
- Verified with `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/node-runner.test.ts`.
- Completed the required `coverage-write` audit pass with no additional changes needed.
- Completed the required final review audit pass with no findings.

Now:
- Close the plan and create the scoped commit.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether any `apps/cloudflare` suite beyond `node-runner.test.ts` also relies on ambient hosted assistant env and needs the same isolation.

Working set (files/ids/commands):
- `apps/cloudflare/test/node-runner.test.ts`
- `apps/cloudflare/test/hosted-execution-fixtures.ts`
- `apps/cloudflare/src/node-runner.ts`
- `packages/operator-config/src/hosted-assistant-config.ts`
- `pnpm --dir apps/cloudflare test -- --runInBand test/node-runner.test.ts`
- `pnpm --dir apps/cloudflare verify`
Status: completed
Updated: 2026-04-21
Completed: 2026-04-21
