# Hosted Usage Reporting Null Guard

## Goal

Ensure hosted runtime usage-record requests cannot supply their own usage reporting attribution when the Worker-owned reporting secret is absent.

Success criteria:

- Valid usage-record web-control bodies always leave the Worker proxy with Worker-owned `usage.reportingUserId`.
- If the Worker reporting secret is unavailable, the proxy clears `usage.reportingUserId` to `null`.
- Focused Cloudflare regression coverage passes, plus typecheck.

## Constraints

- Do not forward platform secrets into hosted child runtime env.
- Preserve unrelated active hosted runner work and dirty ledger rows.
- Do not expose secrets, local usernames, home paths, or direct personal identifiers.

## State

Created 2026-05-12T09:41:00Z.

## Plan

1. Patch the Worker web-control usage body augmentation to rewrite valid usage bodies even when no Worker reporting id can be derived.
2. Add a regression test for absent `HOSTED_AI_USAGE_REPORTING_SECRET`.
3. Run focused tests, `pnpm typecheck`, and diff checks.
4. Close this plan with a scoped commit.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts -t "hosted usage reporting"` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts` passed.
- `pnpm --dir packages/hosted-execution test -- assistant-usage.test.ts` passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-codex-config.test.ts` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/test/runner-outbound.test.ts` passed.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
