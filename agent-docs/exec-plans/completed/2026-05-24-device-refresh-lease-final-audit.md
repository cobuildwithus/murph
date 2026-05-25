Goal:
- Close final subagent findings on hosted device token refresh leases so every token-material read/write path respects the same row lease and terminal status boundary.

Constraints:
- Keep the same simple `DeviceConnection` row-lease primitive; do not add queues, sweepers, or new lock infrastructure.
- Preserve unrelated dirty worktree changes and active plan rows.
- Do not log or expose token material, raw provider responses, local paths, or direct identifiers.

Scope:
- Block runtime snapshot credential material while a current refresh lease is active or stale.
- Block OAuth reconnect/upsert over an active current refresh lease.
- Fail closed on provider refresh errors that happen after a lease is claimed but cannot be classified as a durable provider status.
- Add focused tests for the subagent-reported gaps.

Out of scope:
- General runtime credential architecture changes.
- Unrelated DeepSec findings.

Verification:
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/agent-session-service.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/prisma-store-oauth-connection.test.ts`
  passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/agent-session-service.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/prisma-store-oauth-connection.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:diff ...` for the follow-up working set passed, including apps/web verify, full apps/web tests, lint, typecheck, and build.

State:
- Runtime snapshots now withhold OAuth token material as `none` when the current token version has a refresh lease or the connection is terminal.
- Agent export/refresh now reject terminal connection statuses even if stale token rows still exist.
- OAuth reconnect/upsert now rejects active current refresh leases instead of clearing them while the lease owner may still be refreshing provider tokens.
- Unclassified provider refresh errors after lease claim now fail closed to `TOKEN_REFRESH_STATE_UNKNOWN` and clear token material.
- Focused regressions cover the subagent-reported read/write/status/error gaps and the lease claim/clear state machine.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
