Goal:
- Fix hosted device-sync agent token refresh so provider refresh calls no longer hold an open DB transaction and rotating refresh-token loss is represented by a durable, fail-closed lease state.

Constraints:
- Keep the architecture small: extend the existing `DeviceConnection` authority row rather than adding a queue, background worker, or generic lock subsystem.
- Preserve existing token-version fences and provider/account ownership boundaries.
- Do not log or expose token material, raw provider responses, local paths, or direct identifiers.
- Preserve unrelated dirty worktree changes and active plan rows.

Scope:
- Add minimal refresh lease columns to the hosted device connection schema and migration.
- Add store methods for claim/finalize/release behavior using short transactions.
- Refactor `HostedDeviceSyncAgentSessionService.refreshTokenBundle` so provider HTTP refresh happens outside DB transactions.
- Add focused tests for transaction lifetime, concurrent refresh behavior, and post-provider persistence failure handling.

Out of scope:
- New job queues, recovery sweepers, or generalized distributed lock infrastructure.
- Runtime-provider refresh behavior outside the hosted agent-session token-export path unless directly required by the shared store contract.
- Unrelated DeepSec findings such as WhatsApp consent.

Verification:
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/agent-session-service.test.ts`
  passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/agent-session-service.test.ts`
  passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/agent-session-service.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/prisma-store-oauth-connection.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:diff ...` for the hosted token-refresh working set passed, including apps/web Prisma generation, focused/full apps/web tests, typecheck/build/static page checks, dependency and workspace guards, and diff policy checks.
- Architecture/security/concurrency/coverage subagents completed; follow-up findings were addressed in the working tree.

State:
- Implemented minimal `DeviceConnection` refresh lease columns, claim/clear store methods, and migration.
- Provider refresh now runs outside DB transactions; final persistence uses short mutation transactions, lease-owner checks, and bounded retries.
- Active leases reject refresh/export as retryable in progress; expired same-token leases fail closed to `reauthorization_required` and clear token material.
- Runtime token writes are fenced against active agent refresh leases, reconnect/setup-failure/disconnect paths clear obsolete leases, and token export checks the lease under the canonical mutation lock.
- Tests cover provider I/O outside mutation locks, overlapping refreshes, post-provider persistence retry, stale lease fail-closed behavior, runtime lease fencing, reconnect/setup cleanup, disconnect cleanup, and migration baseline.
- DeepSec report entries for token-refresh durability and long-lived transaction lock are marked fixed in the current working tree.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
