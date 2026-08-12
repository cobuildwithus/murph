# Device Provider Contribution Kit

Last verified: 2026-05-13

## Purpose

This guide is the maintainer playbook for adding a new wearable or health-data provider to Murph.

Use it when you need to land a provider end to end:
- shared provider metadata in `@murphai/importers`
- transport and lifecycle in `@murphai/device-syncd`
- snapshot normalization in `@murphai/importers`
- docs, tests, and optional hosted or onboarding wiring

Start here, then use:
- [`./device-provider-compatibility-matrix.md`](./device-provider-compatibility-matrix.md)
- [`./templates/README.md`](./templates/README.md)

## Current provider architecture

Murph intentionally splits provider work across four seams.

### 1. Shared provider metadata lives in `@murphai/importers`

`packages/importers/src/device-providers/provider-descriptors.ts` is the single shared source for:
- provider key and display name
- implementation-slug aliases that resolve to the provider's public identity (for example Junction's `whoop_v2` resolves to `whoop` through `canonicalizeDeviceProviderSlug`); the wearable query layer and CLI provider filters canonicalize through this seam while vault records keep their raw ingested provenance
- transport modes
- OAuth callback path and default scopes
- webhook path and delivery mode
- sync windows and supported job kinds
- normalization families and parser expectations
- source-priority hints

Both `packages/device-syncd` and `packages/importers` consume that descriptor surface. New providers should extend it instead of inventing a second metadata shape.
That descriptor plus the shared registry helpers are the permanent metadata seam;
adding another provider should not require a second hosted registry or
descriptor copy.

### 2. `packages/device-syncd` owns transport and lifecycle

`device-syncd` owns:
- connect URLs and OAuth callback completion
- token refresh and disconnect behavior
- scheduled backfill and reconcile jobs
- optional webhook verification and fan-in
- local token storage and runtime state outside the vault

The runtime provider object should expose the shared `descriptor` plus behavior hooks only. Do not mirror callback paths, webhook paths, default scopes, or other lifecycle metadata onto extra top-level runtime fields.
Provider-specific webhook-admin secrets also stay on the provider-owned config
and factory path. Do not add them to generic hosted or local env/config types.

If you need the same callback or webhook behavior on a different HTTP surface, reuse `@murphai/device-syncd/public-ingress` instead of forking provider-specific ingress logic.
Shared ingress should only understand the generic preflight plus parse
lifecycle. The provider module owns any provider-specific verification or
challenge behavior.

### 3. `packages/importers` owns parsing and normalization

Importer adapters own:
- snapshot validation and parsing
- bounded evidence-part creation for the integration-ingest record
- conversion into `DeviceBatchImportPayload`
- canonical event, sample, and provenance shaping

Provider adapters should consume the same shared descriptor metadata that `device-syncd` uses.

### 4. `packages/core` remains the only canonical writer

Provider code must not write vault files directly.

The intended path is:
1. `device-syncd` fetches or receives upstream provider data.
2. `device-syncd` hands one provider snapshot to `context.importSnapshot()`.
3. `@murphai/importers` normalizes that snapshot into a device batch.
4. `@murphai/core` performs the canonical write.

That split is the main guardrail for provider contributions. Treat shared metadata, transport, and normalization as separate deliverables even when the same person lands all three in one patch.

## Non-negotiables

- Keep provider credentials outside the canonical vault.
- Keep stored runtime metadata shallow and sanitized; do not persist large nested profile payloads into account metadata.
- Preserve useful upstream evidence as bounded `evidenceParts` when it helps replay, audit, or future re-normalization.
- Reuse existing canonical event kinds and metric names before inventing new ones. Treat generic sample streams as explicit CSV/import/debug ledgers, not provider firehose output.
- If a provider supports webhooks, treat them as routing or freshness hints that enqueue work; normalization still happens through importer snapshots.
- Reuse the shared descriptor and shared registry helper; do not reintroduce provider metadata drift between `device-syncd` and `importers`.
- If you need a hosted or alternate HTTP surface, build it on top of `@murphai/device-syncd/public-ingress` rather than duplicating callback or webhook verification logic.
- Keep hosted and local generic env/config surfaces provider-agnostic. If a
  provider needs a webhook-admin secret, keep it on that provider's config
  reader/factory only.

## Required touchpoints

Most first-class provider additions touch both package seams plus a small set of tests and docs.

### Shared metadata and importer seam

- `packages/importers/src/device-providers/provider-descriptors.ts`
- `packages/importers/src/device-providers/defaults.ts`
- `packages/importers/src/device-providers/<provider>.ts`
- `packages/importers/src/device-providers/index.ts`
- `packages/importers/test/provider-descriptors.test.ts`
- relevant importer tests for the new provider

### `device-syncd` transport seam

- `packages/device-syncd/src/providers/<provider>.ts`
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/test/provider-descriptor-integration.test.ts`
- relevant `device-syncd` tests for auth, jobs, webhook flow, and runtime behavior

### Usually required when the provider should be a first-class published surface

- `packages/device-syncd/src/public-ingress.ts` when the provider should participate in shared callback or webhook ingress exports
- `packages/device-syncd/package.json` for a `./providers/<provider>` export
- `packages/importers/package.json` only if a new importers subpath is needed beyond the existing device-provider surfaces

### Docs and operator surfaces

- `packages/device-syncd/README.md`
- `packages/importers/README.md`
- `README.md` when provider guidance or maintainer routing would otherwise be misleading
- this contribution kit or the compatibility matrix when the provider changes the shared planning surface

### Optional follow-up touchpoints

Update these only when the provider should appear there now:
- `apps/web/src/lib/device-sync/**`
- `packages/cli/src/setup-cli.ts`
- `packages/cli/src/setup-wizard.ts`
- onboarding or hosted settings docs

## Recommended build order

### 1. Scope the first slice

Before writing code, decide the first supported families using the compatibility matrix.

Do not start by chasing every endpoint the provider offers. Prefer the smallest useful slice that still feels first-class for Murph, for example:
- profile or account identity
- sleep summary
- daily activity totals
- readiness or recovery
- workout sessions

Questions to answer first:
- Is the provider polling-first, webhook-first, or both?
- Which lifecycle metadata belongs in the shared descriptor?
- Which collections need true backfill versus a short rolling reconcile window?
- Which metric families fit Murph's current canonical shapes today?
- Which unsupported sections should still be retained as integration-ingest evidence parts?

### 2. Add the shared descriptor first

Before writing transport or normalization code, add a new descriptor to `packages/importers/src/device-providers/provider-descriptors.ts`.

Define at least:
- `provider`
- `displayName`
- `transportModes`
- `oauth` and `webhook` metadata when applicable
- `sync` windows and job kinds
- `normalization.metricFamilies`
- `sourcePriorityHints`

Then:
- add the descriptor to `defaultDeviceProviderDescriptors`
- export it through `packages/importers/src/device-providers/defaults.ts`
- use that descriptor as the single metadata source for both the adapter and `device-syncd` provider

If transport code and normalization code need different metadata, that is usually a sign the descriptor should be expanded rather than duplicated.

### 3. Add the `device-syncd` provider

Use the template in [`./templates/device-sync-provider.template.md`](./templates/device-sync-provider.template.md).

The provider implementation should:
- import the shared descriptor
- derive its runtime `descriptor` from the shared descriptor
- implement OAuth exchange and token refresh when required
- implement scheduled jobs with bounded reconcile windows
- keep webhook handlers light: verify, parse, dedupe, and enqueue
- fetch one provider snapshot inside `executeJob()` and hand that snapshot to `context.importSnapshot()`
- route provider HTTP failures through the shared metadata-only diagnostics
  helpers so endpoint kind, request shape, upstream status, response shape, and
  sanitized provider error reasons are visible without logging tokens, secrets,
  raw paths, query values, request bodies, response bodies, or provider account
  identifiers

Do not widen the runtime provider shape with duplicated metadata fields. Shared lifecycle metadata belongs in `descriptor`; the runtime provider surface should own behavior only.

Strong recommendations:
- Treat `externalAccountId` as the stable cross-job identity boundary.
- Use explicit job kinds such as `backfill`, `reconcile`, `resource`, or `delete`.
- Keep webhook fan-in small and retry-safe; enqueue work instead of normalizing inline.
- Reuse `@murphai/device-syncd/public-ingress` instead of inventing a second callback or webhook surface.

### 4. Add the importer adapter

Use the template in [`./templates/device-provider-adapter.template.md`](./templates/device-provider-adapter.template.md).

The adapter should:
- import and spread the shared descriptor
- validate the upstream snapshot at the boundary, ideally with `zod`
- preserve useful upstream payloads as bounded integration-ingest evidence parts
- emit normalized events, compact display-grade metrics, evidence parts, and provenance
- create stable provider-specific `externalRef` values
- avoid synthesizing precision the provider did not actually send

Strong recommendations:
- Reuse `makeNormalizedDeviceBatch()` and the helpers in `shared-normalization.ts`.
- Declare bounded `authoritativeEventSets` only for a complete, versioned provider resource snapshot with stable resource and facet identities. Core's existing external-reference reconciliation owns revisions and tombstones for omitted facets; partial responses and unversioned snapshots must not claim authority.
- Keep each authoritative resource at or below 514 current facets. This exact bound covers Junction's 512 admitted dated menstrual facts plus its two scalar cycle-length facets; adapters with a smaller composed maximum should keep their own narrower admission cap.
- A public edit of an imported device event is member-owned (`source: manual`) even when the client supplies or inherits `source: device`. Preserve `externalRef` and `dataOrigin` as attribution; a later provider update or omission must reach core's existing typed conflict instead of overwriting or retracting the member revision.
- Retain unsupported-but-useful upstream sections as `snapshot-section:*` evidence parts instead of silently discarding them.
- Prefer existing event kinds such as `observation`, `sleep_session`, and `activity_session`.
- Do not retain high-frequency provider timeseries as full sample-array evidence by default. Fetch only product-needed timeseries, reduce them to compact facts in memory, and persist only tiny evidence parts unless an explicit debug/deep-inspection feature proves the need for full-fidelity retention. Core rejects oversized provider sample batches; do the reduction in the adapter before canonical import.
- A closed-day derived fact must use one explicit vault timezone from scheduling through fetch and normalization. Request an exact half-open datetime window, wait for any documented safety lag, and grant `authoritativeEventSets` replacement only for resources whose fetch succeeded. Successful empty responses may replace an owned facet set; failed, aborted, or yielded responses must not.
- Do not set `queryVisibility`, `visibility`, or `canonicalFact` from provider adapter fields. Device imports keep provider observations out of default query/search promotion unless a separate read/projector path intentionally promotes a derived product fact.
- If you need a new metric family or raw/debug stream, update the compatibility matrix in the same patch.

### 5. Wire config, defaults, exports, and tests

After the provider and adapter exist, wire them into the normal repo seams.

#### `device-syncd`

- add config readers and env handling in `packages/device-syncd/src/config.ts`
- export the provider from `packages/device-syncd/src/index.ts`
- add a `packages/device-syncd/package.json` provider subpath when the provider should be imported directly
- add or extend provider tests covering auth, refresh, missing account identity, job execution, and webhook behavior
- extend `packages/device-syncd/test/provider-descriptor-integration.test.ts` when the new provider should prove descriptor alignment

#### `importers`

- add the adapter to `packages/importers/src/device-providers/defaults.ts`
- export it from `packages/importers/src/device-providers/index.ts`
- extend importer tests for parsing, evidence retention, and canonical mapping
- extend `packages/importers/test/provider-descriptors.test.ts` when the provider should prove descriptor alignment

Any provider change that emits or reshapes canonical events or samples must
also prove at least one representative snapshot through the real
`importDeviceProviderSnapshot(..., { corePort: coreRuntime })` path. Adapter or
normalizer-only assertions are useful, but they are not enough: the fixture must
round-trip through `core.importDeviceBatch` so invalid observation grains,
query promotion fields, unsupported fields, oversized sample batches, and other core-contract drift fail in
tests. High-frequency provider timeseries should be dropped, treated as freshness
hints, or reduced to compact summary/derived facts before persistence; full-fidelity
retention needs an explicit product/debug policy and matching tests.
Committed provider fixtures and assertions must stay synthetic or fully
redacted; never commit real provider tokens, account identifiers, raw private
payload details, local paths, or direct user identifiers to satisfy this proof.

Do not add a second bespoke registry. Both packages already share the keyed registry helper from `provider-descriptors.ts`.

### 6. Decide whether hosted or onboarding surfaces need the provider now

If the provider should also work in hosted settings or control-plane surfaces, wire it into the relevant `apps/web` device-sync helpers.
Reuse the shared configured-provider assembly helpers from `@murphai/device-syncd/config`
instead of adding a second hosted-only provider config object or registration list.
Hosted Postgres persistence should stay provider-generic. A normal provider
addition should not need a provider-specific table or architectural storage
change.

If the provider should appear in local onboarding or setup flows, update the CLI setup surfaces.

Keep this optional. A provider can land first in the local daemon-plus-importer path and only later join hosted or onboarding UX.

## Provider readiness checkpoint

After the current cleanup, the normal next-provider path is intentionally small:
- one shared descriptor entry in `@murphai/importers`
- one transport module in `packages/device-syncd/src/providers`
- one importer adapter in `packages/importers/src/device-providers`
- one shared registration step in `@murphai/device-syncd/config`

That is the steady-state architecture. A normal provider should not require:
- provider-specific webhook secrets on generic hosted or local env/config shapes
- provider-specific branching in shared callback or webhook ingress
- provider-specific hosted persistence tables or a second hosted provider registry

If a provider seems to need one of those, stop and treat it as architecture work rather than routine provider implementation.

### 7. Update docs

At minimum:
- document the provider in `packages/device-syncd/README.md`
- document the adapter in `packages/importers/README.md`
- update any maintainer or operator lists that would otherwise become misleading

If the provider adds a new metric family, naming pattern, or normalization convention, update the compatibility matrix in the same change.

## Contribution checklist

Use this as the merge checklist for a new provider.

The normal end state is still just:
1. shared descriptor
2. `device-syncd` transport module
3. importer adapter
4. shared config/factory registration
5. optional hosted or onboarding exposure when the product needs it

If a provider needs more than that, treat it as an architecture review instead
of quietly branching generic code.

### Descriptor and shared metadata

- [ ] The provider has one shared descriptor in `provider-descriptors.ts`.
- [ ] The descriptor covers transport, sync, normalization, and source-priority hints.
- [ ] Both the adapter and `device-syncd` provider consume that shared descriptor instead of duplicating metadata.
- [ ] The provider is added to `defaultDeviceProviderDescriptors`, and related exports are updated.

### Transport and auth

- [ ] Provider config exists with explicit defaults and timeout or reconcile settings.
- [ ] OAuth or auth flow resolves a stable `externalAccountId`.
- [ ] Access and refresh token behavior is implemented and bounded.
- [ ] Disconnect or revocation behavior is explicit when the provider supports it.
- [ ] Webhook verification exists only when the provider truly supports it.
- [ ] Webhook handlers enqueue work instead of performing heavy normalization inline.

### Scheduling and jobs

- [ ] Initial connect schedules an explicit backfill or seed job.
- [ ] Reconcile scheduling uses bounded windows and dedupe keys.
- [ ] Provider job kinds are explicit and descriptor-aligned.
- [ ] `executeJob()` builds a provider snapshot and passes it through importer normalization.

### Normalization and evidence

- [ ] Snapshot parsing validates the provider boundary.
- [ ] Upstream evidence is retained as bounded integration-ingest evidence parts when it supports replay or future re-normalization.
- [ ] Canonical event kinds and compact metric names reuse existing Murph names whenever possible.
- [ ] `externalRef` values are stable and provider-specific.
- [ ] Unsupported-but-useful sections are retained as evidence parts instead of silently discarded.
- [ ] Profile or account metadata does not copy large nested provider payloads into runtime metadata.

### Wiring and docs

- [ ] `device-syncd` config and exports are wired.
- [ ] importer defaults and exports are wired.
- [ ] shared registry usage remains on the existing helper rather than a bespoke registry.
- [ ] package READMEs mention the provider or the new maintainer surface.
- [ ] hosted or onboarding surfaces are updated when the provider should appear there now.
- [ ] the compatibility matrix is updated if the provider introduces a new family or naming pattern.

### Verification

- [ ] Focused provider tests run for both touched package seams.
- [ ] Repo-level verification runs before merge.
- [ ] Failure cases cover auth errors, token refresh, missing account identity, and malformed snapshots.
- [ ] Webhook providers have verification, dedupe, and unknown-account coverage.
- [ ] Descriptor-alignment tests are updated when the provider becomes a built-in first-class surface.

## Verification commands

For a tight local loop while building the provider:

```bash
pnpm --dir packages/device-syncd typecheck
pnpm --dir packages/device-syncd test
pnpm --dir packages/importers typecheck
pnpm --dir packages/importers test
```

Before merge, run the repo baselines documented in the testing map:

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Current reference providers

Use the existing providers as concrete examples of different integration shapes:
- Junction: shared OAuth/proxy target for configured sources such as Garmin and Fitbit
- Garmin: Junction-backed OAuth plus polling-first reconcile, activity detail descriptors, and women-health support
- WHOOP: OAuth plus webhooks, recovery and workout payloads, and delete fan-in
- Oura: OAuth plus polling-first reconcile, optional webhook verification and admin support, and rich daily readiness or sleep families
- Strava: direct OAuth plus activity/workout imports and direct webhook signing

Study those implementations before inventing a new provider-specific pattern.
