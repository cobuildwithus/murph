# Junction remote disconnect and orphan webhook handling

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Make hosted Junction disconnect cleanly deregister remote Junction provider connections, and make verified stale Junction webhooks stop retrying when their Junction user no longer exists in local Murph state.

## Success criteria

- Junction provider exposes `revokeAccess` and deregisters connected Junction provider slugs for the stored Junction user.
- Hosted disconnect and hosted account deletion call provider `revokeAccess` for stored `provider_config` accounts instead of only OAuth token accounts.
- Verified unknown Junction webhooks complete their trace and return an accepted orphan response instead of permanent `503` retries.
- Provider capabilities advertise Junction remote disconnect.
- Focused tests cover client DELETE calls, provider revoke, hosted provider-config revoke, and orphan webhook handling.

## Scope

- In scope: Junction API client/provider disconnect, hosted revoke call sites, hosted unknown-webhook hook wiring, focused tests, descriptor capability.
- Out of scope: normal-flow Junction user deletion, client-user-id fallback routing, Junction webhook admin endpoint management, broad provider contract redesign.

## Constraints

- Technical constraints: reuse the existing `DeviceSyncAccount` and `connectionHandler.revokeAccess` primitives; keep webhook logs metadata-only and redacted; preserve provider-agnostic ingress/store contracts unless a small extension is directly justified.
- Product/process constraints: ordinary user disconnect deregisters provider connections but does not delete the Junction user; preserve unrelated active Junction resource-alias work and dirty test diagnostics.

## Risks and mitigations

1. Risk: stale Junction/Svix retries keep hitting local dev after DB wipes.
   Mitigation: verified unknown Junction webhooks are accepted as orphan traces and deduped by existing webhook trace persistence.
2. Risk: provider-config accounts are skipped by hosted revoke paths.
   Mitigation: use stored `DeviceSyncAccount` directly for revoke instead of deriving an OAuth-only token bundle first.
3. Risk: normal disconnect over-deletes remote Junction state.
   Mitigation: call provider deregistration per connected provider slug; keep whole-user delete out of product disconnect.

## Tasks

1. Add Junction DELETE client methods and diagnostics.
2. Add Junction provider `revokeAccess` over current connected provider slugs.
3. Mark Junction remote disconnect capability true.
4. Generalize hosted disconnect/account-deletion revoke call sites to provider-config accounts.
5. Wire hosted unknown-webhook hook and accept unknown Junction webhooks.
6. Add focused regression tests and run required verification.

## Decisions

- Keep `user_id`/stored `externalAccountId` as the canonical Junction routing key.
- Do not add `client_user_id` fallback routing for this bug.
- Do not delete Junction users in normal disconnect; reserve user deletion for a separate explicit dev/admin cleanup.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/prisma-store-oauth-connection.test.ts apps/web/test/agent-route.test.ts` passed.
- `pnpm --dir packages/device-syncd test -- test/junction-provider.test.ts test/public-ingress.test.ts test/provider-descriptor-integration.test.ts` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/device-syncd test:coverage` passed.
- `pnpm test:diff apps/web/src/lib/device-sync/wake-service.ts apps/web/src/lib/device-sync/prisma-store.ts apps/web/src/lib/device-sync/prisma-store/connections.ts apps/web/src/lib/hosted-privacy/account-data-service.ts packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/providers/junction-client.ts packages/device-syncd/src/public-ingress.ts` reached `apps/web verify`; build, lint, and dev smoke completed, but the app test lane failed in `apps/web/test/prisma-store-device-sync-signal.test.ts` because the concurrent webhook-trace owner-lock fake Prisma transaction lacks `$queryRaw`. That failure is outside this task's diff.
Completed: 2026-05-26
