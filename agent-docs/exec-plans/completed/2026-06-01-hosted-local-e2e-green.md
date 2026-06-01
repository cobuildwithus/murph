# Hosted Local E2E Green

## Goal

Make canonical hosted-local E2E pass locally, with focused proof for the Linq
webhook/scheduled-reminder path and any follow-on hosted runner failures.

## Scope

- Hosted assistant mailbox/import/auto-reply/outbox delivery behavior.
- Cloudflare hosted-local E2E harness and narrowly related runner tests.
- No web product/control-plane contract expansion unless evidence requires it.

## Constraints

- Preserve unrelated working-tree edits.
- Keep provider credentials Worker-owned and avoid widening child env forwarding.
- Do not log raw provider payloads, direct identifiers, local paths, or secrets.
- Use root `pnpm hosted-local e2e` as the canonical non-manual suite.

## Plan

1. Reproduce or isolate the failing Linq hosted-local route/runner boundary.
2. Add focused regression coverage for the root cause.
3. Rerun focused hosted-local scenarios, then the canonical suite.
4. Run required typecheck/coverage and completion audits.

## Root Cause

The old aggregate E2E run became stuck after the E2E worker tried to reuse a
Cloudflare-managed local runner image tag that had been removed or rebuilt while
another local dev stack was active. The durable symptom was repeated runner
container startup failure for a missing `cloudflare-dev/runnercontainer` image,
not a MinIO data-path failure.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/hosted-local-e2e.test.ts scripts/dev-hosted-local/runtime.cleanup.test.ts scripts/dev-hosted-local/stack.test.ts scripts/dev-hosted-local/minio.test.ts`
- `pnpm --dir packages/hosted-local-harness typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-callbacks.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts`
- `pnpm hosted-local e2e linq-webhook`
- `pnpm hosted-local e2e`
- `pnpm typecheck`
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
