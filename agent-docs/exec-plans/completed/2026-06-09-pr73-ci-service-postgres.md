# PR73 CI Gate Fixes

## Goal

Fix the PR 73 CI gate failures observed on the hosted E2E lanes.

Success criteria:

- Hosted E2E workflow Postgres services use a stable, explicit image tag.
- Postgres readiness checks authenticate against the configured test database
  instead of relying on a bare default-user probe.
- Hosted device-sync runtime startup returns bounded `retry_later` responses
  when the native container readiness RPC stalls instead of holding the
  `ensure-processing` HTTP request until the caller aborts.
- Guard/unit tests and CI documentation describe the hardened contracts.
- Focused verification passes locally before the PR branch is pushed.

## Scope

- `.github/workflows/cloudflare-hosted-e2e.yml`
- `.github/workflows/cloudflare-hosted-device-sync-e2e.yml`
- `apps/cloudflare/src/user-runner/runtime-processing-controller.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `packages/cli/test/cloudflare-hosted-e2e-workflow-guards.test.ts`
- `tsconfig.base.json`
- Hosted E2E CI documentation under `agent-docs/`

## Constraints

- Do not change Junction runtime behavior for this CI-service fix.
- Do not add secrets, package dependencies, or new runtime state.
- Preserve the hosted-local E2E harness contract unless evidence points there.

## Plan

1. Confirm the latest failing job location and branch head.
2. Harden the GitHub Actions Postgres service definitions.
3. Bound hosted runtime startup confirmation and keep it retry-safe.
4. Update workflow/runtime guard coverage and CI docs.
5. Run focused verification.
6. Complete required review, finish the plan, and push the scoped fix.
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
