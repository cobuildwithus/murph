# Computer-Use ReviewGPT Round 6 Fixes

## Goal

Resolve accepted ReviewGPT round 6 findings on PR 214:

1. Isolate persistent Kernel profiles by explicit deployment/trust-boundary namespace.
2. Keep browser ownership recoverable through ambiguous provisioning and checkpoint failures.
3. Avoid replaying raw login/OAuth callback URLs into replacement browsers.
4. Prevent replacement browsers from extending beyond the run expiry.
5. Delete unused goal, finish summary, and unused error-state contract/storage if still scoped.

## Constraints

- Prefer simple persisted ownership and compare-and-swap invariants over new orchestration.
- Keep Kernel work outside DB transactions.
- Do not preserve speculative API fields.
- Keep tests focused on security and lifecycle invariants.

## Working Set

- `apps/web/src/lib/computer-use/kernel-client.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/2026061700_hosted_computer_use/migration.sql`
- `apps/web/app/api/internal/computer/runs/**`
- `packages/hosted-execution/src/computer-use.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- focused computer-use/privacy tests

## Verification Plan

- Focused computer-use and API tests.
- `apps/web` typecheck.
- Affected package typechecks if hosted-execution/assistant-engine contracts change.
- `pnpm test:diff`.
- `git diff --check` and privacy scan.
- Push and rerun ReviewGPT.

## Current State

- Round 6 response supplied by user; local ReviewGPT response file never landed.
- Stale ReviewGPT process was stopped.

## Verification Notes

- Focused coverage worker added regression coverage for namespace use, browser-name reuse, and run-lifetime timeout caps.
- Security review found two medium issues: normalized namespace collisions and account-deletion cleanup blocking when namespace config is missing. Both were fixed and covered.
- Deep review found two high issues: deploy skew from deleting `goal`/`summary` too abruptly and missing namespace deployment documentation/config behavior. Both were fixed and covered.
- Security rerun found no remaining medium-or-higher security/privacy findings.
- Deep rerun found one accepted regression: the legacy `summary` field was sent to `computer_act` instead of `computer_finish_run`. Fixed and covered with request-body assertions.
- `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-computer-tools.test.ts` passed after the transport fix.
- `pnpm --dir packages/assistant-engine typecheck` passed after the transport fix.
- `git diff --check` passed.
- Static compatibility sweep found no remaining `.shape` callers on transformed hosted-computer start/finish schemas, and `goal`/`summary` now appear only in deliberate compatibility/parser/test paths.
- `pnpm verify:acceptance` passed.
- After deleting the unused TTL constant, `pnpm --dir apps/web lint`, `pnpm --dir apps/web typecheck`, `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-execution-computer-use.test.ts`, `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-computer-tools.test.ts packages/hosted-execution/test/hosted-execution.test.ts`, and `git diff --check` all passed.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
