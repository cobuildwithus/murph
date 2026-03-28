# Linq Remediations Closeout Plan

## Goal

Finish the remaining Linq remediation follow-ups found during audit without widening into adjacent hosted-onboarding Stripe work, then close out the lane with focused verification plus the repo-required checks.

## Scope

- `packages/inboxd`: Linq connector contract hardening, bounded attachment download timeout handling, canonical normalization cleanup, and targeted regression tests.
- `packages/cli`: local Linq connector boundary typing and fail-closed secret startup coverage.
- `apps/web`: hosted Linq binding-store duplicate read-path coverage and explicit full-scan stopgap documentation.

## Constraints

- Keep this behavior-preserving and inside the current Linq lane.
- Do not commit overlapping hosted-onboarding Stripe refactors as part of this closeout.
- Do not delete hosted binding rows or introduce a schema migration in this pass.
- Preserve existing hosted error codes/messages and local connector semantics except where the current contract was already broken.

## Verification

- `pnpm exec vitest run --config packages/inboxd/vitest.config.ts packages/inboxd/test/linq-connector.test.ts packages/inboxd/test/linq-webhook.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/prisma-store-linq-binding.test.ts apps/web/test/linq-control-plane.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config ./.tmp-vitest-cli-linq-config.mts packages/cli/test/inbox-service-boundaries.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/inboxd typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
