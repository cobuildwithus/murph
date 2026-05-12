# Remove non-provider hosted secrets from runner env

Status: implementation
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Stop forwarding non-provider platform secrets into the hosted assistant runtime
  child environment while preserving required hosted usage/logging behavior
  through Worker-owned or web-control capabilities.

## Success criteria

- `HOSTED_RUNTIME_ENV_PROFILE_KEYS.assistant` does not include
  `HOSTED_AI_USAGE_REPORTING_SECRET` or `HOSTED_LOG_FINGERPRINT_SECRET`.
- Hosted runner job JSON, container requests, child stdin, and child process env
  do not carry those keys.
- Hosted usage records can still receive a stable reporting user id through a
  Worker-owned path when `HOSTED_AI_USAGE_REPORTING_SECRET` is configured.
- Focused tests and required typecheck/review workflow pass or any blocker is
  reported with exact scope.

## Scope

- In scope: hosted runtime env profile policy, Cloudflare runner web-control
  usage forwarding, focused tests/docs directly tied to this boundary.
- Out of scope: provider credential intercept policy, hosted-local E2E behavior,
  Durable Object scheduling, unrelated in-process runner cleanup.

## Constraints

- Do not expose local identifiers, secret values, raw env, or direct personal
  identifiers in files, logs, tests, docs, or commits.
- Preserve unrelated active hosted runner edits and stop/report if overlapping
  dirty files block a safe scoped commit.

## Risks and mitigations

1. Risk: usage reporting loses stable anonymized user attribution.
   Mitigation: fill missing usage `reportingUserId` at the Worker web-control
   proxy before forwarding to web.
2. Risk: diagnostic fingerprinting regresses silently.
   Mitigation: tests must prove the raw fingerprint secret no longer enters the
   child/job surfaces; any remaining fingerprint behavior must be explicitly
   Worker-owned or reported as intentionally unavailable from child env.

## Tasks

1. Remove the two non-provider secrets from the shared assistant env profile.
2. Update hosted runner env and static-secret invariant tests.
3. Add Worker-side usage reporting id augmentation and focused proxy coverage.
4. Run focused verification, required audits, and close through `finish-task`
   when safe.

## Decisions

- The child runtime should not receive a derived replacement secret just to keep
  synchronous local fingerprint helpers working; that would preserve the same
  authority problem in a different key.
- Worker-side usage augmentation overwrites any incoming `usage.reportingUserId`
  when `HOSTED_AI_USAGE_REPORTING_SECRET` is configured; the child runtime is
  not trusted to supply that field.

## Verification

- Passed: `pnpm --dir packages/hosted-execution test -- assistant-usage.test.ts`
- Passed: `pnpm --dir packages/assistant-runtime test -- hosted-runtime-codex-config.test.ts`
- Passed before security-review fix: `pnpm --dir apps/cloudflare test -- node-runner-hosted-assistant.test.ts hosted-runner-static-secret-invariant.test.ts runner-outbound.test.ts`
- Passed after security-review fix:
  `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts`
- Passed after security-review fix:
  `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts -t "adds hosted usage reporting attribution inside the Worker web-control proxy"`
- Passed: `git diff --check` over touched files.
- Blocked/unrelated: `pnpm typecheck` failed in
  `apps/cloudflare/src/runner-effects-contract.ts` because unrelated active
  hosted-runner edits removed provider-effect exports still imported elsewhere.
- Blocked/unrelated: path-scoped `scripts/workspace-verify.sh test:diff ...`
  failed in `packages/cli/test/stdin-input.test.ts` timeout, outside this diff.
