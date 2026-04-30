# Parallelize the Junction device-sync implementation

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

Define how to split the Junction device-sync implementation across local subagents without creating conflicting schema, contract, or runtime changes.

This is a companion to `agent-docs/exec-plans/completed/2026-04-30-add-junction-device-sync.md`. The completed plan is an immutable snapshot, so this file records the parallel execution plan.

## Success criteria

- Work is split into subagent lanes with clear write ownership.
- Contract and schema work happens before dependent Junction implementation work.
- Parallel lanes do not edit the same files unless a listed merge gate has completed.
- Each lane has focused tests and a clear handoff.
- Required repo completion reviews are placed before final handoff, not treated as optional cleanup.
- The implementation can land in small commits or PRs without a large unresolved integration diff.

## Ground rules

- Keep the first merge gate small: generic `hosted_link`, provider-config auth, and source projection contracts.
- Do not start Junction REST, importer, webhook, or UI workers against unstable contracts.
- Workers are not alone in the codebase. Each worker must preserve unrelated dirty work and must not revert edits outside its write set.
- Use package public entrypoints. Do not add sibling `src/` or `dist/` imports.
- Do not add dependencies unless the worker owns the lockfile update and documents why a built-in or repo-local helper was not enough.
- Keep secrets provider-owned. Junction API keys, HMAC secrets, and webhook secrets must not enter account records, runtime snapshots, logs, fixtures, or docs examples.
- Keep webhook work polling-first-compatible. Webhooks enqueue fetch/reconcile jobs; they are not the only data path.

## Dependency graph

```txt
Wave 0: final contract sketch
  -> Wave 1A: provider descriptor/public ingress contracts
  -> Wave 1B: local SQLite auth/source storage
  -> Wave 1C: hosted Prisma auth/source storage
  -> Wave 1D: hosted assistant-runtime hydration, after 1B/1C contracts

Wave 1 merge gate: auth/source contracts compile end to end
  -> Wave 2A: Junction client and provider connect/reconcile
  -> Wave 2B: Junction importer and fixtures
  -> Wave 2C: hosted/local callback surfaces
  -> Wave 2D: fixture corpus, if the importer fixtures become large

Wave 2 merge gate: Link start/callback/reconcile/import pass focused tests
  -> Wave 3A: Junction webhooks
  -> Wave 3B: settings/source-state UI
  -> Wave 3C: docs and compatibility matrix

Wave 3 merge gate: polling plus webhook-triggered fetches verified
  -> Wave 4A: source-aware query priority, if product needs it
  -> Wave 4B: final audits and finish-task
```

## Wave 0: Contract Lead

Run this lane locally before spawning implementation workers. It is too central to delegate as a long-running worker.

Owner: parent agent.

Write set:

```txt
packages/importers/src/device-providers/provider-descriptors.ts
packages/device-syncd/src/types.ts
packages/device-syncd/src/client.ts
packages/device-syncd/src/public-ingress.ts
packages/device-syncd/src/hosted-runtime.ts
```

Output:

- `hosted_link` transport mode.
- Generic link descriptor beside OAuth descriptor.
- `ProviderAuthMaterial` union with `account_tokens` and `provider_config`.
- Optional provider hooks for begin/complete connection.
- `connecting` account status or an equivalent explicit pending-link state.
- Draft source projection type names and fields for local and hosted storage.
- Small type fixtures that let workers compile against stable names.

Why this is serialized:

- These files define the API that every other lane consumes.
- If this lane changes names or storage shape late, all workers rebase.
- Keep the implementation shallow in Wave 0. The goal is a stable contract, not a complete provider.
- Do not create Prisma or SQLite migrations in Wave 0. The store workers own those migrations after the contract names are stable.

Merge gate:

```txt
pnpm typecheck
pnpm test:diff packages/importers/src/device-providers/provider-descriptors.ts packages/device-syncd/src/types.ts packages/device-syncd/src/client.ts packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/hosted-runtime.ts
```

## Wave 1: Foundation Workers

Wave 1 workers can run in parallel after Wave 0 lands. Their write sets should stay disjoint.

### Worker 1A: Device-Sync Ingress and OAuth Compatibility

Responsibility:

- Make existing OAuth providers work through the new generic begin/complete hooks.
- Keep `describeProvider()`, `startConnection()`, and callback handling compatible with non-OAuth providers.

Write set:

```txt
packages/device-syncd/src/public-ingress.ts
packages/device-syncd/src/http.ts
packages/device-syncd/src/service.ts
packages/device-syncd/test/public-ingress.test.ts
packages/device-syncd/test/device-sync-service*.test.ts
```

Must not edit:

```txt
apps/web/prisma/**
apps/web/src/lib/device-sync/prisma-store/**
packages/importers/src/device-providers/junction.ts
packages/device-syncd/src/providers/junction*.ts
```

Focused tests:

```txt
pnpm test:diff packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/http.ts packages/device-syncd/src/service.ts packages/device-syncd/test/public-ingress.test.ts
pnpm --dir packages/device-syncd test:coverage
```

Handoff:

- List any adapter defaults added for OAuth providers.
- Confirm hosted-link providers do not require OAuth `code`.

### Worker 1B: Local SQLite Store and Runtime Hydration

Responsibility:

- Add local storage support for provider-config accounts.
- Add local source projection storage.
- Keep token export and refresh fail-closed for provider-config auth.

Write set:

```txt
packages/device-syncd/src/store/schema.ts
packages/device-syncd/src/store/accounts.ts
packages/device-syncd/src/store/hosted-account-hydration.ts
packages/device-syncd/test/store*.test.ts
packages/device-syncd/test/hosted-account-hydration*.test.ts
```

Focused tests:

```txt
pnpm test:diff packages/device-syncd/src/store/schema.ts packages/device-syncd/src/store/accounts.ts packages/device-syncd/src/store/hosted-account-hydration.ts
pnpm --dir packages/device-syncd test:coverage
```

Handoff:

- Document migration behavior for existing token accounts.
- Confirm provider-config auth is not exported as tokens.

### Worker 1C: Hosted Prisma Store and Runtime Snapshot

Responsibility:

- Add hosted database support for provider-config accounts and source projection.
- Update hosted runtime snapshot/apply/hydration paths so provider-config accounts can be restored without token bundles.

Write set:

```txt
apps/web/prisma/schema.prisma
apps/web/prisma/migrations/<new-junction-auth-source-migration>/migration.sql
apps/web/src/lib/device-sync/prisma-store/connections.ts
apps/web/src/lib/device-sync/prisma-store/connection-records.ts
apps/web/src/lib/device-sync/prisma-store/connection-secrets.ts
apps/web/src/lib/device-sync/internal-runtime.ts
apps/web/src/lib/device-sync/hosted-runtime-authority.ts
apps/web/src/lib/device-sync/agent-session-service.ts
apps/web/test/device-sync*.test.ts
apps/web/test/hosted-runtime*.test.ts
apps/web/test/agent-session-service.test.ts
```

Focused tests:

```txt
pnpm test:diff apps/web/prisma/schema.prisma apps/web/src/lib/device-sync/prisma-store/connections.ts apps/web/src/lib/device-sync/internal-runtime.ts
pnpm --dir apps/web verify
```

Handoff:

- Include migration name and affected tables.
- Confirm provider-config auth is omitted from token bundle exports.
- Confirm token export and agent-session token refresh paths reject provider-config accounts with a clear non-exportable error.

### Worker 1D: Hosted Assistant-Runtime Device Sync Hydration

Responsibility:

- Hydrate hosted provider-config snapshots into local device-sync state without treating `tokenBundle: null` as a token-clear event.
- Keep assistant-runtime behavior aligned with the device-syncd hosted runtime contract.

Write set:

```txt
packages/assistant-runtime/src/hosted-device-sync-runtime.ts
packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts
```

Focused tests:

```txt
pnpm test:diff packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts
pnpm --dir packages/assistant-runtime test:coverage
```

Handoff:

- Confirm account-token snapshots still hydrate normally.
- Confirm provider-config snapshots hydrate without token material and without clearing existing provider-config state.

## Wave 1 Merge Gate

The parent agent integrates Wave 1 and resolves contract drift.

Required checks:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/types.ts packages/device-syncd/src/public-ingress.ts packages/device-syncd/src/store/schema.ts apps/web/prisma/schema.prisma apps/web/src/lib/device-sync/prisma-store/connections.ts apps/web/src/lib/device-sync/internal-runtime.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir apps/web verify
pnpm --dir packages/assistant-runtime test:coverage
```

Do not start Wave 2 until this gate passes or failures are clearly unrelated and documented.

## Wave 2: Junction Polling MVP Workers

Wave 2 can run in parallel after the auth/source contracts are stable.

### Worker 2A: Junction Client, Provider, and Manifest

Responsibility:

- Add Junction descriptor, env parsing, serializable config, provider factory wiring, client, and provider implementation.
- Implement create/resolve user, Link token generation, begin connection, callback outcome recording, reconcile, and bounded resource fetch jobs.

Write set:

```txt
packages/importers/src/device-providers/provider-descriptors.ts
packages/importers/src/device-providers/defaults.ts
packages/importers/src/device-providers/index.ts
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/src/providers/junction-client.ts
packages/device-syncd/src/config/provider-env.ts
packages/device-syncd/src/config/provider-types.ts
packages/device-syncd/src/config/provider-manifests.ts
packages/device-syncd/src/config/serializable-provider-configs.ts
packages/device-syncd/src/config/provider-factory.ts
packages/device-syncd/src/index.ts
packages/device-syncd/test/junction-provider.test.ts
```

Focused tests:

```txt
pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/providers/junction-client.ts packages/device-syncd/src/config/provider-manifests.ts
pnpm --dir packages/device-syncd test:coverage
```

Handoff:

- Confirm `client_user_id` is HMAC-derived.
- Confirm parent account is upserted before returning Link URL.
- Confirm callback is weak and reconcile is authoritative.

### Worker 2B: Junction Importer and Resource Fixtures

Responsibility:

- Normalize the bounded v1 resource set into existing Murph canonical records.
- Preserve downstream source attribution and raw evidence.
- Add fixtures for timestamp policy, including floating-time Libre-style examples.

Write set:

```txt
packages/importers/src/device-providers/junction.ts
packages/importers/test/device-providers-junction.test.ts
packages/importers/README.md
```

Focused tests:

```txt
pnpm test:diff packages/importers/src/device-providers/junction.ts packages/importers/test/device-providers-junction.test.ts packages/importers/test/fixtures/junction
pnpm --dir packages/importers test:coverage
```

Handoff:

- List every imported resource and every intentionally ignored resource.
- Confirm `externalRef.system = "junction"` and `externalRef.resourceType = "${sourceSlug}:${resource}"`.
- Confirm floating timestamps are not silently converted as UTC.
- Do not edit importer registry/default files in this lane unless Worker 2A has handed them off.

### Worker 2C: Hosted and Local Link Surfaces

Responsibility:

- Wire hosted/local routes and settings entry points to the generic hosted-link flow.
- Keep OAuth callback routes intact.

Write set:

```txt
apps/web/app/api/device-sync/link/[provider]/callback/route.ts
apps/web/src/lib/device-sync/http.ts
apps/web/src/lib/device-sync/public-ingress-service.ts
apps/web/src/lib/device-sync/settings-surface.ts
apps/web/test/device-sync*.test.ts
packages/device-syncd/src/http.ts
packages/device-syncd/test/http*.test.ts
```

Focused tests:

```txt
pnpm test:diff apps/web/app/api/device-sync/link/[provider]/callback/route.ts apps/web/src/lib/device-sync/public-ingress-service.ts packages/device-syncd/src/http.ts
pnpm --dir apps/web verify
pnpm --dir packages/device-syncd test:coverage
```

Handoff:

- Confirm `GET /connect/junction`, hosted settings connect, and link callback share the same provider flow.
- Confirm OAuth routes still work.
- Confirm local `/link/junction/callback` and hosted `/api/device-sync/link/junction/callback` consume `murph_state` or state, record weak outcome, enqueue reconcile, and redirect with existing callback query parameters.

### Worker 2D: Junction Fixture Corpus

Use this worker only if the importer fixtures become more than a few small inline samples. Otherwise Worker 2B can own them.

Responsibility:

- Build small synthetic Junction fixtures for every default v1 resource.
- Cover multi-source cases and floating timestamp cases.
- Keep fixtures free of real identifiers, API keys, device ids, local paths, and vendor tokens.

Write set:

```txt
packages/importers/test/fixtures/junction/**
packages/importers/test/device-providers-junction.test.ts
```

Focused tests:

```txt
pnpm test:diff packages/importers/test/fixtures/junction packages/importers/test/device-providers-junction.test.ts
pnpm --dir packages/importers test:coverage
```

Handoff:

- List each fixture and the source/resource behavior it proves.
- Confirm no fixture contains real personal or device identifiers.

## Wave 2 Merge Gate

The parent agent integrates Wave 2 and verifies the polling MVP.

Required checks:

```txt
pnpm typecheck
pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/importers/src/device-providers/junction.ts apps/web/app/api/device-sync/link/[provider]/callback/route.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir packages/importers test:coverage
pnpm --dir apps/web verify
```

Manual or mocked proof to capture:

- Link start returns a Junction `link_web_url`.
- Parent `junction` account exists before redirect.
- Callback enqueues reconcile without requiring OAuth `code`.
- Reconcile updates source projection and imports bounded resources.

## Wave 3: Webhooks, Settings, and Docs

Wave 3 starts after polling works. Webhooks depend on the same source projection and job queue used by polling.

### Worker 3A: Junction Webhooks

Responsibility:

- Verify Svix raw-body signatures.
- Dedupe by `svix-id` or a stable fallback key.
- Route connection, historical, daily, and exhausted-message events into reconcile/resource jobs.
- Return retryable errors for unknown accounts that may be racing Link completion.

Write set:

```txt
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/src/webhook-verification.ts
packages/device-syncd/test/junction-webhook*.test.ts
apps/web/app/api/device-sync/webhooks/[provider]/route.ts
apps/web/src/lib/device-sync/wake-service.ts
apps/web/test/device-sync-webhook*.test.ts
```

Focused tests:

```txt
pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/webhook-verification.ts apps/web/app/api/device-sync/webhooks/[provider]/route.ts
pnpm --dir packages/device-syncd test:coverage
pnpm --dir apps/web verify
```

Handoff:

- Confirm invalid signatures fail before parsing trusted content.
- Confirm historical events enqueue fetch jobs instead of importing empty webhook payloads.
- Confirm webhook secrets do not serialize into hosted runtime config.
- Confirm `svix-id` is the preferred trace/dedupe key, with a deterministic fallback only when needed.
- Confirm trace completion happens only after durable job or wake persistence.

### Worker 3B: Settings Source-State UI

Responsibility:

- Show one Junction card first.
- Add source-level rows only if the source projection has useful user-facing state.
- Keep text neutral and avoid overpromising direct provider parity.

Write set:

```txt
apps/web/src/lib/device-sync/settings-surface.ts
apps/web/src/lib/device-sync/settings-service.ts
apps/web/app/(dashboard)/settings/**
apps/web/src/components/settings/**
apps/web/test/device-sync-settings*.test.ts
apps/web/test/hosted-device-sync-settings*.test.ts*
```

Focused tests:

```txt
pnpm test:diff apps/web/src/lib/device-sync/settings-surface.ts apps/web/src/components/settings
pnpm --dir apps/web verify
```

Additional required pass:

- Run the repo-required frontend review subagent if the UI changes user-facing pages or components.

### Worker 3C: Durable Docs and Compatibility Matrix

Responsibility:

- Update provider contribution docs, hosted control-plane docs, compatibility matrix, and testing map after behavior exists.
- Keep claims aligned with verified behavior.

Write set:

```txt
docs/device-provider-contribution-kit.md
docs/device-provider-compatibility-matrix.md
docs/device-sync-hosted-control-plane.md
agent-docs/references/testing-ci-map.md
```

Focused tests:

```txt
pnpm test:diff docs/device-provider-contribution-kit.md docs/device-provider-compatibility-matrix.md docs/device-sync-hosted-control-plane.md agent-docs/references/testing-ci-map.md
```

## Wave 3 Merge Gate

Required checks:

```txt
pnpm typecheck
pnpm --dir packages/device-syncd test:coverage
pnpm --dir packages/importers test:coverage
pnpm --dir apps/web verify
pnpm test:diff docs/device-provider-contribution-kit.md docs/device-provider-compatibility-matrix.md docs/device-sync-hosted-control-plane.md agent-docs/references/testing-ci-map.md
```

Required review subagents before handoff:

- `security-privacy-review`: required on every implementation wave that touches auth material, secrets, health data, external routes, webhooks, runtime snapshots, token export, or account identifiers.
- `coverage-write`: required for the generic seam, provider-config auth, importer, and webhooks.
- `frontend-review`: required only if Wave 3B changes user-facing UI.
- `task-finish-review`: required before final commit/handoff for code-bearing implementation waves.
- `simplify`: use for large locally-grown diffs where complexity starts to climb, especially if a worker changes more than about 200 lines outside tests.

Prefer full acceptance verification for the final combined high-risk merge if the shared checkout is not already red for unrelated reasons:

```txt
pnpm verify:acceptance
```

## Wave 4: Optional Source-Aware Query Priority

Do this only after source provenance and source projection are both landed.

Worker 4A responsibility:

- Teach query candidates to derive `upstreamSourceSlug` from Junction records.
- Extend provider policy to rank direct providers above Junction for overlapping direct-supported sources.
- Let Junction win for sources Murph does not support directly.

Write set:

```txt
packages/query/src/wearables/candidates.ts
packages/query/src/wearables/provider-policy.ts
packages/query/src/wearables/types.ts
packages/query/test/wearables-*.test.ts
```

Focused tests:

```txt
pnpm test:diff packages/query/src/wearables/candidates.ts packages/query/src/wearables/provider-policy.ts packages/query/src/wearables/types.ts
pnpm --dir packages/query test:coverage
```

Do not include this in the first Junction polling PR unless product behavior requires source-specific conflict resolution immediately.

## Serialization Matrix

Must be serialized:

- Final auth/runtime contract shape: `auth.kind`, `secretRef`, status enum, and nullable token-bundle semantics.
- Prisma schema and migration creation. One worker owns the migration.
- Local SQLite schema version and migration semantics. One worker owns the version bump.
- Hosted runtime parser/snapshot changes in `packages/device-syncd/src/hosted-runtime.ts`; apps/web and assistant-runtime must consume the same contract.
- Token export and agent-session refresh behavior for provider-config accounts.
- The first merge of public ingress plus local and hosted stores.

Safe to parallelize after Wave 0:

- Local SQLite storage and hosted Prisma storage.
- Ingress tests and hosted store tests, if they do not both edit shared type files.
- Junction importer normalization and Junction provider/client work, after the snapshot/source contract is stable.
- UI settings work and Junction provider work, if the UI consumes only stable descriptors and does not edit routes or stores.

Safe to parallelize after Wave 2:

- Webhook verification and source-level UI refinement, once polling/reconcile and source projection are proven.
- Docs and compatibility matrix updates, once implementation behavior is verified.

Not safe to parallelize:

- Generic seam work with callback routes, webhook routing, token export, hosted runtime snapshot/apply, or source projection storage.
- Webhook work before parent account persistence and polling/reconcile are proven.
- Source-aware query policy before importer provenance fixtures exist.

## Recommended subagent prompts

Use these as starting points. Keep each worker on its write set.

### Worker 1A prompt

```txt
Implement the device-sync ingress half of the generic hosted_link/provider_config seam.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- packages/device-syncd/src/public-ingress.ts
- packages/device-syncd/src/http.ts
- packages/device-syncd/src/service.ts
- directly coupled device-syncd tests

Use this companion parallelization plan and the original Junction plan at agent-docs/exec-plans/completed/2026-04-30-add-junction-device-sync.md.

Goal:
- Existing OAuth providers keep working.
- Hosted-link providers do not require OAuth code.
- Provider begin/complete hooks have stable adapter defaults.

Run focused tests and list changed files.
```

### Worker 1B prompt

```txt
Implement local device-sync storage support for provider_config auth and compact source projection.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- packages/device-syncd/src/store/schema.ts
- packages/device-syncd/src/store/accounts.ts
- packages/device-syncd/src/store/hosted-account-hydration.ts
- directly coupled store/hydration tests

Goal:
- Existing token accounts migrate cleanly.
- Provider-config accounts can be created/listed/scheduled.
- Provider-config auth is not exportable as token material.
- Source projection is compact and keyed by parent connection plus source slug.

Run focused tests and list changed files.
```

### Worker 1C prompt

```txt
Implement hosted Prisma/runtime support for provider_config auth and source projection.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- apps/web/prisma/schema.prisma
- the new Prisma migration
- apps/web/src/lib/device-sync/prisma-store/**
- apps/web/src/lib/device-sync/internal-runtime.ts
- directly coupled apps/web tests

Goal:
- Provider-config accounts store a provider secret reference, not per-user tokens.
- Hosted runtime snapshots can restore provider-config accounts without token bundles.
- Token export/refresh paths fail clearly for provider-config accounts.

Run focused tests and list changed files.
```

### Worker 1D prompt

```txt
Implement hosted assistant-runtime hydration support for provider_config device-sync accounts.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- packages/assistant-runtime/src/hosted-device-sync-runtime.ts
- packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts

Goal:
- Account-token snapshots continue to hydrate normally.
- Provider-config snapshots hydrate without token material.
- tokenBundle: null is not treated as a token-clear event for provider-config accounts.
- Runtime behavior matches the device-syncd hosted runtime contract.

Run focused tests and list changed files.
```

### Worker 2A prompt

```txt
Implement the Junction device-sync client/provider/manifest after the generic seam lands.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only Junction provider, config, descriptor wiring, and directly coupled device-syncd tests.

Goal:
- HMAC Junction client_user_id.
- Create or resolve Junction user.
- Upsert parent account before returning Link URL.
- Generate Link token and return link_web_url.
- Callback records weak outcome and enqueues reconcile.
- Reconcile reads connected providers/resources and updates source projection.

Do not implement importer normalization or webhook verification in this lane.
Run focused tests and list changed files.
```

### Worker 2B prompt

```txt
Implement Junction importer normalization and fixtures.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- packages/importers/src/device-providers/junction.ts
- Junction importer fixtures/tests
- importer registration docs if needed

Goal:
- Import only the v1 bounded resource set.
- Preserve raw evidence and downstream source attribution.
- Use externalRef.system = "junction".
- Use externalRef.resourceType = "${sourceSlug}:${resource}".
- Add floating-time fixtures and prove Libre-like timestamps are not silently converted as UTC.

Run focused tests and list changed files.
```

### Worker 2C prompt

```txt
Wire hosted and local Junction Link callback surfaces after the generic seam lands.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only hosted/local route and settings-surface glue plus directly coupled tests.

Goal:
- Hosted settings can start the generic hosted-link provider flow.
- Local control plane can start /connect/junction and receive /link/junction/callback.
- OAuth callback routes continue to work.

Do not implement the Junction provider client or importer in this lane.
Run focused tests and list changed files.
```

### Worker 2D prompt

```txt
Build the Junction importer fixture corpus.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- packages/importers/test/fixtures/junction/**
- directly coupled Junction importer fixture tests

Goal:
- Cover each default v1 resource with small synthetic payloads.
- Cover multi-source attribution and floating timestamp cases.
- Keep fixtures free of real identifiers, API keys, device ids, local paths, and vendor tokens.

Run focused tests and list changed files.
```

### Worker 3A prompt

```txt
Implement Junction webhook verification and routing after polling works.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only webhook verification/routing files and directly coupled tests.

Goal:
- Verify Svix raw-body signatures before trusting payloads.
- Dedupe deliveries.
- Route provider.connection.created and data events into reconcile/resource jobs.
- Treat historical events as fetch notifications, not data payloads.
- Return retryable errors for unknown accounts.

Do not add a dependency unless you also update the lockfile and document why built-in crypto is insufficient.
Run focused tests and list changed files.
```

### Worker 3B prompt

```txt
Implement the Junction settings surface after the descriptor and source projection contracts are stable.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only settings-service/surface files, settings components, and directly coupled settings tests.

Goal:
- Show one Junction card and a Connect devices CTA.
- Do not create downstream pseudo-provider cards.
- Add source-level rows only if source projection has useful user-facing state.
- Keep callback success/error refresh behavior aligned with existing settings patterns.

Run focused tests, request frontend review if user-facing UI changed, and list changed files.
```

### Worker 4A prompt

```txt
Implement source-aware Junction query priority after Junction provenance and source projection have landed.

You are not alone in the codebase. Preserve unrelated dirty work and do not revert edits outside your write set.

Own only:
- packages/query/src/wearables/candidates.ts
- packages/query/src/wearables/provider-policy.ts
- packages/query/src/wearables/types.ts
- directly coupled query tests

Goal:
- Derive upstreamSourceSlug from Junction externalRef.resourceType.
- Prefer direct providers for directly supported sources.
- Let Junction win for sources Murph does not support directly.
- Do not add sourceOverrides until query policy consumes them.

Run focused tests and list changed files.
```

## Integration rules for the parent agent

- Start with Wave 0 locally, then spawn Wave 1 workers.
- Wait only at merge gates. While workers run, prepare tests, fixtures, and docs that do not overlap their write sets.
- Review each worker's diff before integrating the next wave.
- If two workers need the same file, stop and serialize that file through the parent agent.
- Keep commits scoped by wave. Do not combine schema/auth seam changes with Junction REST or webhook behavior.
- If a required broad check fails for a pre-existing reason, record the failing command, failing target, and why the current diff did not cause it.
- Before final handoff, run the repo completion workflow required for the task class and use `scripts/finish-task` while the active plan is still present.

## Open questions

- Exact source projection table names should be chosen in Wave 0 and then treated as stable.
- Decide whether `connecting` becomes a public account status or an internal pending flag.
- Decide whether webhook Svix verification uses built-in crypto or the Svix SDK after the implementation worker evaluates complexity.
- Decide whether source-aware query priority is needed for v1 or can remain a follow-up.
Completed: 2026-04-30
