# Linq Remediation Followups Plan

## Goal

Close the current Linq correctness gaps across local inboxd/CLI and hosted `apps/web` without reopening older fail-open behavior or widening into unrelated onboarding/channel changes.

## Scope

- `packages/inboxd`: shared Linq webhook parsing/validation/types, local webhook connector semantics, and attachment-hydration behavior/comments.
- `packages/cli`: local Linq connector/runtime typing plus setup/readiness/doctor UX so the fail-closed webhook-secret contract is stated consistently.
- `apps/web`: hosted onboarding Linq parsing/retry handling, hosted recipient-binding lookup/preference logic, and focused member/onboarding regressions.
- Targeted Linq tests only in the affected packages/apps.

## Constraints

- Preserve the new fail-closed local webhook-secret behavior.
- Keep hosted sparse routing intentionally sparse; do not tighten it into full capture validation unless the path already depends on strict message semantics.
- Do not introduce a schema migration or delete legacy binding rows in this lane.
- If reordering capture persistence versus attachment hydration would change externally visible semantics, either keep the current order and make the code/tests honest or split the behavior carefully with explicit coverage.
- Ignore unrelated dirty worktree changes unless they directly conflict with these Linq files.

## Planned Changes

1. Align local CLI/setup/runtime surfaces with the now-required `LINQ_WEBHOOK_SECRET`.
2. Fix or accurately narrow the local attachment-hydration guarantee, including realistic async timing coverage.
3. Reuse shared Linq parsing/validation more consistently, tighten misleading names/types, and add malformed-payload coverage.
4. Harden hosted recipient-binding verification/retry classification without deleting history-bearing rows, and add duplicate-row boundary coverage.
5. Add focused hosted member metadata and malformed `message.id` regression tests.

## Verification

- `pnpm exec vitest run --config packages/inboxd/vitest.config.ts packages/inboxd/test/linq-webhook.test.ts packages/inboxd/test/linq-connector.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run packages/cli/test/inbox-service-boundaries.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/setup-channels.test.ts packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-http.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/linq-control-plane.test.ts apps/web/test/linq-webhook-route.test.ts apps/web/test/prisma-store-linq-binding.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
