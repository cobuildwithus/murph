# Junction connection and credential primitives

Status: active
Created: 2026-04-30
Updated: 2026-05-01

## Goal

Land the first implementation slice from `agent-docs/exec-plans/active/2026-04-30-junction-greenfield-primitive-v2.md`: generic connection-flow and account-credential primitives needed before a Junction provider can be added.

## Scope

In scope for this slice:

- `external_link` provider connection metadata.
- Device-sync manifest `credentialPolicy` validation for `oauth_tokens`, `provider_config`, and `none`.
- Generic begin/complete connection hooks with OAuth compatibility.
- Ingress-owned `connectionSeed` validation and persistence before redirect.
- `setupPhase` / `setupExpiresAt` pending-link state without expanding lifecycle `status`.
- `DeviceAccountCredential` flowing through provider results, public upsert, stored accounts, job context, hosted snapshots, and hydration.
- Provider-config accounts that do not require fake access tokens.
- Provider-config credentials failing closed for token refresh/export and hosted token-bundle mutation paths.
- `DeviceDataOrigin` shape updates needed by the next source-projection/importer slice, without adding Junction ingestion yet.
- Settings-source setup rendering for the new `setupPhase` state only, so pre-Link parent rows are visible as setup-in-progress rather than normal connected accounts.
- The smallest tests needed to prove existing OAuth providers still work.

Out of scope for this slice:

- Junction REST client, Link token calls, resources, importer, and webhooks.
- Source projection table and Junction data-bearing import behavior.
- Broader settings/source UI beyond the setup-phase status overlay.

## Decisions

- Use `external_link`, not `hosted_link`.
- Store provider-config credentials as `credential_kind = "provider_config"` plus `provider_config_key`, not `env:*` secret refs.
- Provider-config account rows must validate against the device-sync manifest `credentialPolicy`; arbitrary `providerConfigKey` values are not accepted.
- Configured provider manifests own credential policy over provider instance fields.
- Keep `status` as lifecycle health (`active`, `reauthorization_required`, `disconnected`). Use `setupPhase = "pending_link"` and `setupExpiresAt` for pre-Link parent rows.
- External-link callbacks must match any seeded parent account and keep setup expiry bounded while still pending.
- Provider callbacks must not mix the new `credential` union with legacy `tokens`.
- Keep existing OAuth callback routes as aliases while adding generic connection callback names.
- Do not store raw Junction client user ids or API keys in account metadata.
- Do not let provider state metadata override the ingress-owned owner/user id.
- Junction config uses `JUNCTION_ENV` and `JUNCTION_REGION` plus API-key/canonical-base-URL validation; tests and mocks should inject `fetchImpl` rather than configuring an alternate runtime host.
- Timeseries backfills will use narrower defaults than summary backfills.
- Unknown-account Junction webhooks should become signed orphan traces plus delayed bind/reconcile, not forced provider retry loops.

## State

Now:

- First primitive wave is implemented across shared descriptors, device-syncd local storage/runtime, assistant hosted-runtime hydration, and hosted web Prisma/runtime seams.
- The implementation uses `setupPhase` / `setupExpiresAt` for pre-Link setup and keeps lifecycle `status` to `active`, `reauthorization_required`, and `disconnected`.
- Device-sync manifest credential policy validates provider-config credentials; importer descriptors only carry connection-flow/catalog metadata.
- Security/coverage repairs from the GPT-5.5 xhigh review wave are incorporated: state metadata cannot override owner identity, raw owner/user/client ids are stripped from account/credential/runtime metadata, hosted runtime credential replacement is manifest-policy checked, disconnect clears setup fields, and web callback routes use the generic connect route with OAuth as an alias.
- Final security review repairs are incorporated: hosted credential rows fail closed on invalid `credential_kind` and non-token/token-material mixtures, the additive Prisma migration adds credential/setup `CHECK` constraints, and provider-supplied callback state metadata is privacy-filtered before storage and before provider callback handling.
- Hosted Prisma changes now land in an additive `2026050100_device_connection_credentials_setup` migration; the init migration is not the owner for the new credential/setup columns.
- Seeded external-link callback/setup failures now mark the seeded parent account as failed instead of leaving an active pending-link row.
- Seeded external-link callbacks now reject external-account mismatches, preserve pending setup expiry, and reject mixed `credential`/`tokens` callback results.
- Built-in manifest credential policy now takes precedence over provider instance overrides.
- Public provider descriptors now support null callbacks for callback-less flows, and startConnection fails explicitly when a callback-required flow lacks a callback URL.
- Provider catalog generation now resolves generic connection metadata instead of OAuth-only descriptor fields.
- Hosted settings source rendering now treats `pending_link` and `link_returned` as setup-in-progress, and failed/expired setup as reconnectable, without changing lifecycle `status`.
- Hosted local-heartbeat fixture rows now include explicit `oauth_tokens` credential kind so the fail-closed hosted credential mapper is exercised without legacy invalid rows.
- `DeviceDataOrigin` carries source attribution plus timestamp semantics, origin confidence, and normalizer version.
- PR 2 provenance/source-projection foundation is now implemented in the active checkout: local SQLite and hosted Prisma both have `device_connection_source` projection storage keyed by parent connection plus opaque source instance key, deterministic listing, same-provider multi-instance coverage, and additive hosted migration `2026050101_device_connection_sources`.
- Canonical wearable data-source identity now includes origin identity, with tests proving two Junction upstream source slugs under one aggregator account do not collapse.

Next:

- Pause here before starting Junction polling. The next implementation slice should add the Junction provider descriptor/config/client and polling MVP on top of the now-present connection credential, source projection, and origin primitives.
- Preserve unrelated active-row edits in the dirty tree; do not attempt a scoped commit from this overlap-heavy checkout without rechecking ownership.
- Full hosted-web test remains red on unrelated dirty-tree UI/content expectations and an older modified migration assertion outside this slice; focused device-sync web coverage is green. The standalone hosted migration snapshot test also remains red on that older hosted-vault-sync assertion before it can exercise the new device-sync migration checks.
- Source-projection workers completed focused verification, but no scoped commit was created because the checkout contains broad unrelated active-row edits.

Latest verification:

```txt
pnpm --dir packages/device-syncd typecheck
pnpm --dir packages/device-syncd test
pnpm --dir packages/importers typecheck
pnpm --dir packages/importers test
pnpm --dir packages/assistant-runtime typecheck
pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --config vitest.config.ts --no-coverage
pnpm --dir apps/web typecheck
pnpm exec vitest run apps/web/test/prisma-store-local-heartbeat.test.ts apps/web/test/device-sync-settings-surface.test.ts apps/web/test/device-sync-callback-route.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts apps/web/test/prisma-store-oauth-connection.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm exec vitest run apps/web/test/prisma-store-connection-sources.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm --dir packages/importers exec vitest run test/canonical-wearables.test.ts --config vitest.config.ts --no-coverage
git diff --check
```

Known unrelated red checks:

```txt
pnpm --dir apps/web lint
pnpm --dir apps/web test
```

## Working Set

Likely touched files:

```txt
packages/importers/src/device-providers/provider-descriptors.ts
packages/device-syncd/src/types.ts
packages/device-syncd/src/public-ingress.ts
packages/device-syncd/src/service.ts
packages/device-syncd/src/store/schema.ts
packages/device-syncd/src/store/accounts.ts
packages/device-syncd/src/store/hosted-account-hydration.ts
packages/device-syncd/src/hosted-runtime.ts
packages/assistant-runtime/src/hosted-device-sync-runtime.ts
apps/web/src/lib/device-sync/**
apps/web/app/api/device-sync/connect/[provider]/callback/route.ts
apps/web/app/api/device-sync/oauth/[provider]/callback/route.ts
apps/web/prisma/schema.prisma
apps/web/prisma/migrations/2026050100_device_connection_credentials_setup/migration.sql
apps/web/test/device-sync-*.test.ts
```
